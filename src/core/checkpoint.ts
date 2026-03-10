import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../storage/database';
import { saveSnapshot, loadSnapshot, removeCheckpointDiffs } from '../storage/diff-store';
import { hashContent } from '../utils/hash';
import { getOrCreateSession } from './session';
import { getOrCreateDefaultTask } from './task-manager';
import { computeDiff, createNewFileDiff, createDeleteFileDiff } from './diff-engine';

export interface Checkpoint {
  id: string;
  task_id: string;
  session_id: string;
  created_at: string;
  tool_name: string | null;
  tool_input: string | null;
  reasoning: string | null;
  sequence: number;
}

export interface CheckpointFile {
  id: string;
  checkpoint_id: string;
  file_path: string;
  diff_content: string | null;
  snapshot_path: string | null;
  content_hash: string | null;
  file_existed: number;
  file_size: number | null;
}

function getNextSequence(rewindDir: string, sessionId: string): number {
  const db = getDb(rewindDir);
  const row = db.prepare(
    'SELECT MAX(sequence) as max_seq FROM checkpoints WHERE session_id = ?'
  ).get(sessionId) as { max_seq: number | null };
  return (row.max_seq ?? 0) + 1;
}

/**
 * Create a checkpoint that snapshots the current state of files BEFORE a tool runs.
 * Stores full gzipped copies so we can restore on rollback.
 */
export function createCheckpoint(
  rewindDir: string,
  toolName: string,
  toolInput: string,
  filePaths: string[],
  reasoning?: string
): Checkpoint {
  const db = getDb(rewindDir);
  const session = getOrCreateSession(rewindDir);
  const task = getOrCreateDefaultTask(rewindDir);
  const id = uuidv4();
  const now = new Date().toISOString();
  const sequence = getNextSequence(rewindDir, session.id);

  // Insert checkpoint
  db.prepare(
    'INSERT INTO checkpoints (id, task_id, session_id, created_at, tool_name, tool_input, reasoning, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, task.id, session.id, now, toolName, toolInput, reasoning || null, sequence);

  // Snapshot each file
  for (const filePath of filePaths) {
    const fileId = uuidv4();
    let content: Buffer;
    let fileExisted: number;
    let fileSize: number | null;
    let contentHash: string | null;
    let snapshotPath: string | null = null;
    let diffContent: string | null = null;

    try {
      content = fs.readFileSync(filePath);
      fileExisted = 1;
      fileSize = content.length;
      contentHash = hashContent(content);
      snapshotPath = saveSnapshot(rewindDir, id, contentHash, content);
    } catch {
      // File doesn't exist yet (will be created by the tool)
      fileExisted = 0;
      fileSize = null;
      contentHash = null;
      content = Buffer.from('');
    }

    db.prepare(
      'INSERT INTO checkpoint_files (id, checkpoint_id, file_path, diff_content, snapshot_path, content_hash, file_existed, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(fileId, id, filePath, diffContent, snapshotPath, contentHash, fileExisted, fileSize);
  }

  return { id, task_id: task.id, session_id: session.id, created_at: now, tool_name: toolName, tool_input: toolInput, reasoning: reasoning || null, sequence };
}

/**
 * After a tool runs, compute and store the diff between pre-snapshot and current state.
 */
export function recordPostState(rewindDir: string, checkpointId: string): void {
  const db = getDb(rewindDir);

  const files = db.prepare(
    'SELECT * FROM checkpoint_files WHERE checkpoint_id = ?'
  ).all(checkpointId) as CheckpointFile[];

  for (const file of files) {
    let newContent: string;
    let oldContent: string;

    // Get old content
    if (file.snapshot_path) {
      oldContent = loadSnapshot(file.snapshot_path).toString('utf-8');
    } else {
      oldContent = '';
    }

    // Get new content
    try {
      newContent = fs.readFileSync(file.file_path, 'utf-8');
    } catch {
      // File was deleted
      if (oldContent) {
        const diff = createDeleteFileDiff(file.file_path, oldContent);
        db.prepare('UPDATE checkpoint_files SET diff_content = ? WHERE id = ?').run(diff, file.id);
      }
      continue;
    }

    // Compute diff
    let diff: string;
    if (!file.file_existed) {
      diff = createNewFileDiff(file.file_path, newContent);
    } else {
      diff = computeDiff(file.file_path, oldContent, newContent);
    }

    const newHash = hashContent(Buffer.from(newContent));
    db.prepare(
      'UPDATE checkpoint_files SET diff_content = ?, content_hash = ?, file_size = ? WHERE id = ?'
    ).run(diff, newHash, Buffer.byteLength(newContent), file.id);
  }
}

/**
 * Rollback a single checkpoint — restore files to their pre-checkpoint state.
 * Creates a "redo" checkpoint first so the undo can be reversed.
 */
export function rollbackCheckpoint(rewindDir: string, checkpointId: string): string[] {
  const db = getDb(rewindDir);
  const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as Checkpoint | undefined;
  if (!checkpoint) return [];

  const files = db.prepare(
    'SELECT * FROM checkpoint_files WHERE checkpoint_id = ?'
  ).all(checkpointId) as CheckpointFile[];

  if (files.length === 0) {
    // Empty checkpoint — just delete it
    db.prepare('DELETE FROM checkpoints WHERE id = ?').run(checkpointId);
    return [];
  }

  // Save current state as a redo checkpoint BEFORE restoring
  const filePaths = files.map(f => f.file_path).filter(f => {
    try { fs.accessSync(f); return true; } catch { return false; }
  });

  if (filePaths.length > 0) {
    createCheckpoint(
      rewindDir,
      'redo',
      JSON.stringify({ undone_checkpoint: checkpointId }),
      filePaths,
      `Redo point for undoing ${checkpointId.slice(0, 8)}`
    );
  }

  // Now restore files
  const restoredFiles: string[] = [];

  for (const file of files) {
    if (file.snapshot_path) {
      try {
        const content = loadSnapshot(file.snapshot_path);
        fs.writeFileSync(file.file_path, content);
        restoredFiles.push(file.file_path);
      } catch {
        // snapshot missing or write failed
      }
    } else if (!file.file_existed) {
      try {
        fs.unlinkSync(file.file_path);
        restoredFiles.push(file.file_path);
      } catch {
        // Already gone
      }
    }
  }

  // Mark checkpoint as undone (soft delete) instead of hard delete
  db.prepare('DELETE FROM checkpoint_files WHERE checkpoint_id = ?').run(checkpointId);
  db.prepare('DELETE FROM checkpoints WHERE id = ?').run(checkpointId);
  removeCheckpointDiffs(rewindDir, checkpointId);

  return restoredFiles;
}

/**
 * Rollback all checkpoints in a task (newest first).
 */
export function rollbackTask(rewindDir: string, taskId: string): string[] {
  const db = getDb(rewindDir);
  const checkpoints = db.prepare(
    'SELECT * FROM checkpoints WHERE task_id = ? ORDER BY sequence DESC'
  ).all(taskId) as Checkpoint[];

  const allRestored: string[] = [];
  for (const cp of checkpoints) {
    const restored = rollbackCheckpoint(rewindDir, cp.id);
    allRestored.push(...restored);
  }

  return [...new Set(allRestored)];
}

/**
 * Rollback all checkpoints in a session (newest first).
 */
export function rollbackSession(rewindDir: string, sessionId: string): string[] {
  const db = getDb(rewindDir);
  const checkpoints = db.prepare(
    'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY sequence DESC'
  ).all(sessionId) as Checkpoint[];

  const allRestored: string[] = [];
  for (const cp of checkpoints) {
    const restored = rollbackCheckpoint(rewindDir, cp.id);
    allRestored.push(...restored);
  }

  return [...new Set(allRestored)];
}

/**
 * List checkpoints with their files.
 */
export function listCheckpoints(rewindDir: string, limit = 20): (Checkpoint & { files: CheckpointFile[] })[] {
  const db = getDb(rewindDir);
  const checkpoints = db.prepare(
    'SELECT * FROM checkpoints ORDER BY sequence DESC LIMIT ?'
  ).all(limit) as Checkpoint[];

  return checkpoints.map(cp => {
    const files = db.prepare(
      'SELECT * FROM checkpoint_files WHERE checkpoint_id = ?'
    ).all(cp.id) as CheckpointFile[];
    return { ...cp, files };
  });
}

/**
 * Get a single checkpoint by ID (supports prefix matching).
 */
export function getCheckpoint(rewindDir: string, idPrefix: string): (Checkpoint & { files: CheckpointFile[] }) | null {
  const db = getDb(rewindDir);
  const cp = db.prepare(
    'SELECT * FROM checkpoints WHERE id LIKE ? ORDER BY sequence DESC LIMIT 1'
  ).get(`${idPrefix}%`) as Checkpoint | undefined;

  if (!cp) return null;

  const files = db.prepare(
    'SELECT * FROM checkpoint_files WHERE checkpoint_id = ?'
  ).all(cp.id) as CheckpointFile[];

  return { ...cp, files };
}

/**
 * Get the most recent checkpoint.
 */
export function getLatestCheckpoint(rewindDir: string): Checkpoint | null {
  const db = getDb(rewindDir);
  return (db.prepare(
    'SELECT * FROM checkpoints ORDER BY sequence DESC LIMIT 1'
  ).get() as Checkpoint) || null;
}
