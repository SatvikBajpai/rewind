import { getRewindDir } from '../../utils/config';
import { initializeDb, getDb } from '../../storage/database';
import { rollbackCheckpoint, rollbackTask, rollbackSession, getLatestCheckpoint, getCheckpoint } from '../../core/checkpoint';
import { getActiveTask } from '../../core/task-manager';
import { getActiveSession } from '../../core/session';
import { success, error, dim } from '../../utils/format';

interface UndoOptions {
  force?: boolean;
}

export function undoCommand(scope?: string, options?: UndoOptions): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);

  if (scope === 'task') {
    undoTask(rewindDir);
  } else if (scope === 'session') {
    undoSession(rewindDir, options?.force || false);
  } else if (scope === 'redo') {
    undoRedo(rewindDir);
  } else if (scope) {
    // Treat as checkpoint ID
    undoById(rewindDir, scope);
  } else {
    undoLast(rewindDir);
  }
}

function undoLast(rewindDir: string): void {
  const latest = getLatestCheckpoint(rewindDir);
  if (!latest) {
    console.log(dim('Nothing to undo.'));
    return;
  }

  // Skip redo checkpoints — undo the next real one
  if (latest.tool_name === 'redo') {
    const db = getDb(rewindDir);
    const next = db.prepare(
      "SELECT * FROM checkpoints WHERE tool_name != 'redo' ORDER BY sequence DESC LIMIT 1"
    ).get() as any;
    if (!next) {
      console.log(dim('Nothing to undo.'));
      return;
    }
    const restored = rollbackCheckpoint(rewindDir, next.id);
    printRestored(next.id, restored);
    return;
  }

  const restored = rollbackCheckpoint(rewindDir, latest.id);
  printRestored(latest.id, restored);
}

function undoById(rewindDir: string, idPrefix: string): void {
  const cp = getCheckpoint(rewindDir, idPrefix);
  if (!cp) {
    console.log(error(`Checkpoint not found: ${idPrefix}`));
    return;
  }

  const restored = rollbackCheckpoint(rewindDir, cp.id);
  printRestored(cp.id, restored);
}

function undoTask(rewindDir: string): void {
  const task = getActiveTask(rewindDir);
  if (!task) {
    console.log(error('No active task to undo.'));
    return;
  }

  const db = getDb(rewindDir);
  const count = (db.prepare('SELECT COUNT(*) as c FROM checkpoints WHERE task_id = ?').get(task.id) as any).c;

  if (count === 0) {
    console.log(dim('No checkpoints in this task.'));
    return;
  }

  console.log(dim(`Undoing task "${task.name}" (${count} checkpoints)...`));
  const restored = rollbackTask(rewindDir, task.id);

  if (restored.length === 0) {
    console.log(dim('No files to restore.'));
    return;
  }

  console.log(success(`Rolled back task "${task.name}" (${restored.length} files restored)`));
  for (const f of restored) {
    console.log(dim(`  restored: ${f}`));
  }
  console.log(dim('A redo checkpoint was saved. Use `rewind undo redo` to reverse this.'));
}

function undoSession(rewindDir: string, force: boolean): void {
  const session = getActiveSession(rewindDir);
  if (!session) {
    console.log(error('No active session to undo.'));
    return;
  }

  const db = getDb(rewindDir);
  const count = (db.prepare('SELECT COUNT(*) as c FROM checkpoints WHERE session_id = ?').get(session.id) as any).c;

  if (count === 0) {
    console.log(dim('No checkpoints in this session.'));
    return;
  }

  if (!force) {
    console.log(error(`This will undo ${count} checkpoints in the current session.`));
    console.log(error('Run with --force to confirm: rewind undo session --force'));
    return;
  }

  console.log(dim(`Undoing entire session (${count} checkpoints)...`));
  const restored = rollbackSession(rewindDir, session.id);

  if (restored.length === 0) {
    console.log(dim('No files to restore.'));
    return;
  }

  console.log(success(`Rolled back entire session (${restored.length} files restored)`));
  for (const f of restored) {
    console.log(dim(`  restored: ${f}`));
  }
  console.log(dim('A redo checkpoint was saved for each undone checkpoint.'));
}

function undoRedo(rewindDir: string): void {
  // Find the most recent redo checkpoint and undo IT (which restores the state before undo)
  const db = getDb(rewindDir);
  const redo = db.prepare(
    "SELECT * FROM checkpoints WHERE tool_name = 'redo' ORDER BY sequence DESC LIMIT 1"
  ).get() as any;

  if (!redo) {
    console.log(dim('No redo checkpoints available.'));
    return;
  }

  const restored = rollbackCheckpoint(rewindDir, redo.id);
  if (restored.length === 0) {
    console.log(dim('Nothing to redo.'));
    return;
  }

  console.log(success(`Redo: restored ${restored.length} file(s) to post-undo state`));
  for (const f of restored) {
    console.log(dim(`  restored: ${f}`));
  }
}

function printRestored(checkpointId: string, restored: string[]): void {
  if (restored.length === 0) {
    console.log(dim(`Removed empty checkpoint ${checkpointId.slice(0, 8)}`));
    return;
  }
  console.log(success(`Rolled back checkpoint ${checkpointId.slice(0, 8)}`));
  for (const f of restored) {
    console.log(dim(`  restored: ${f}`));
  }
  console.log(dim('Redo available: `rewind undo redo`'));
}
