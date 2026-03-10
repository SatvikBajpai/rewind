#!/usr/bin/env node

/**
 * PostToolUse hook for Claude Code.
 * Records diffs AFTER a tool has modified files.
 * For Bash: scans filesystem to detect ALL changed files (not just pre-identified ones).
 */

import { findRewindDir, getProjectRoot } from '../utils/config';
import { initializeDb, getDb } from '../storage/database';
import { recordPostState } from '../core/checkpoint';
import { saveSnapshot } from '../storage/diff-store';
import { hashContent } from '../utils/hash';
import { computeDiff, createNewFileDiff } from '../core/diff-engine';
import { debugLog, debugError } from '../utils/log';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.rewind', 'dist', 'build', '.next',
  '__pycache__', '.pytest_cache', 'venv', '.vscode', '.idea',
  'coverage', '.nyc_output', '.DS_Store',
]);

function buildMtimeMap(dir: string, result: Record<string, number>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name.length > 1) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      buildMtimeMap(fullPath, result);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        result[fullPath] = stat.mtimeMs;
      } catch {
        // skip
      }
    }
  }
}

/**
 * For Bash commands: compare pre-mtime map with current state to find ALL changed files.
 * Add newly discovered files to the checkpoint.
 */
function detectBashFileChanges(rewindDir: string, checkpointId: string): void {
  const mtimePath = path.join(rewindDir, 'pre_mtime_map.json');

  let preMtimeMap: Record<string, number>;
  try {
    preMtimeMap = JSON.parse(fs.readFileSync(mtimePath, 'utf-8'));
    fs.unlinkSync(mtimePath);
  } catch {
    return; // No mtime map available
  }

  const projectRoot = getProjectRoot(rewindDir);
  const postMtimeMap: Record<string, number> = {};
  buildMtimeMap(projectRoot, postMtimeMap);

  const db = getDb(rewindDir);

  // Find already-tracked files for this checkpoint
  const existingFiles = db.prepare(
    'SELECT file_path FROM checkpoint_files WHERE checkpoint_id = ?'
  ).all(checkpointId) as { file_path: string }[];
  const trackedPaths = new Set(existingFiles.map(f => f.file_path));

  // Detect modified files (mtime changed)
  for (const [filePath, postMtime] of Object.entries(postMtimeMap)) {
    if (trackedPaths.has(filePath)) continue; // Already tracked by pre-hook

    const preMtime = preMtimeMap[filePath];

    if (preMtime === undefined) {
      // New file created by Bash command
      try {
        const content = fs.readFileSync(filePath);
        const hash = hashContent(content);
        const diff = createNewFileDiff(filePath, content.toString('utf-8'));

        db.prepare(
          'INSERT INTO checkpoint_files (id, checkpoint_id, file_path, diff_content, snapshot_path, content_hash, file_existed, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), checkpointId, filePath, diff, null, hash, 0, content.length);
      } catch {
        // skip unreadable files
      }
    } else if (postMtime > preMtime) {
      // File was modified
      try {
        const currentContent = fs.readFileSync(filePath);
        const hash = hashContent(currentContent);

        // We don't have the pre-state content, but we can still record the current state
        // Save a snapshot of current state for potential future rollback info
        const snapshotPath = saveSnapshot(rewindDir, checkpointId, hash, currentContent);

        // Create a diff note (we don't have true before, but record we detected a change)
        const diff = `--- ${filePath}\n+++ ${filePath}\n@@ File modified by Bash command @@\n(mtime-detected change, full before-state not captured)`;

        db.prepare(
          'INSERT INTO checkpoint_files (id, checkpoint_id, file_path, diff_content, snapshot_path, content_hash, file_existed, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), checkpointId, filePath, diff, snapshotPath, hash, 1, currentContent.length);
      } catch {
        // skip
      }
    }
  }

  // Detect deleted files
  for (const filePath of Object.keys(preMtimeMap)) {
    if (trackedPaths.has(filePath)) continue;
    if (postMtimeMap[filePath] !== undefined) continue;

    // File existed before Bash, now it's gone
    db.prepare(
      'INSERT INTO checkpoint_files (id, checkpoint_id, file_path, diff_content, snapshot_path, content_hash, file_existed, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), checkpointId, filePath, `--- ${filePath}\n(file deleted by Bash command)`, null, null, 1, null);
  }
}

async function main() {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const event = JSON.parse(input);

    const mutatingTools = ['Write', 'Edit', 'MultiEdit', 'Bash'];
    if (!mutatingTools.includes(event.tool_name)) {
      process.stdout.write('{}');
      return;
    }

    const rewindDir = findRewindDir();
    if (!rewindDir) {
      process.stdout.write('{}');
      return;
    }

    initializeDb(rewindDir);

    // Read pending checkpoint from PreToolUse
    const pendingPath = path.join(rewindDir, 'pending_checkpoint.json');
    let checkpointId: string;
    let toolName: string;
    try {
      const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
      checkpointId = pending.checkpointId;
      toolName = pending.toolName;
      fs.unlinkSync(pendingPath);
    } catch {
      // Fall back to old format
      const oldPath = path.join(rewindDir, 'pending_checkpoint.txt');
      try {
        checkpointId = fs.readFileSync(oldPath, 'utf-8').trim();
        toolName = event.tool_name;
        fs.unlinkSync(oldPath);
      } catch {
        process.stdout.write('{}');
        return;
      }
    }

    // Record diffs for pre-identified files
    recordPostState(rewindDir, checkpointId);

    // For Bash: scan filesystem to find additional changed files
    if (toolName === 'Bash') {
      detectBashFileChanges(rewindDir, checkpointId);
    }

    process.stdout.write('{}');
  } catch (err) {
    debugError('post-tool-use', err);
    process.stdout.write('{}');
  }
}

main();
