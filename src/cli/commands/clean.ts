import { getRewindDir } from '../../utils/config';
import { initializeDb, getDb } from '../../storage/database';
import { removeCheckpointDiffs } from '../../storage/diff-store';
import { success, dim } from '../../utils/format';
import fs from 'fs';
import path from 'path';

export function cleanCommand(): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);
  const db = getDb(rewindDir);

  let cleaned = 0;

  // 1. Find orphaned checkpoints (no files recorded — pre-hook ran but post-hook didn't)
  const orphanedCheckpoints = db.prepare(`
    SELECT c.id FROM checkpoints c
    LEFT JOIN checkpoint_files cf ON cf.checkpoint_id = c.id
    WHERE cf.id IS NULL
  `).all() as { id: string }[];

  for (const cp of orphanedCheckpoints) {
    db.prepare('DELETE FROM checkpoints WHERE id = ?').run(cp.id);
    removeCheckpointDiffs(rewindDir, cp.id);
    cleaned++;
  }

  // 2. Find checkpoints where all files have no diff (nothing actually changed)
  const emptyCheckpoints = db.prepare(`
    SELECT c.id FROM checkpoints c
    WHERE NOT EXISTS (
      SELECT 1 FROM checkpoint_files cf
      WHERE cf.checkpoint_id = c.id AND cf.diff_content IS NOT NULL AND cf.diff_content != ''
    )
    AND EXISTS (
      SELECT 1 FROM checkpoint_files cf WHERE cf.checkpoint_id = c.id
    )
  `).all() as { id: string }[];

  for (const cp of emptyCheckpoints) {
    db.prepare('DELETE FROM checkpoint_files WHERE checkpoint_id = ?').run(cp.id);
    db.prepare('DELETE FROM checkpoints WHERE id = ?').run(cp.id);
    removeCheckpointDiffs(rewindDir, cp.id);
    cleaned++;
  }

  // 3. Clean up stale temp files
  const tempFiles = ['pending_checkpoint.json', 'pending_checkpoint.txt', 'pre_mtime_map.json', 'reasoning_buffer.txt'];
  for (const f of tempFiles) {
    const p = path.join(rewindDir, f);
    try {
      fs.unlinkSync(p);
    } catch {
      // not there
    }
  }

  // 4. Remove orphaned tasks (no checkpoints)
  const orphanedTasks = db.prepare(`
    SELECT t.id FROM tasks t
    LEFT JOIN checkpoints c ON c.task_id = t.id
    WHERE c.id IS NULL AND t.status = 'completed'
  `).all() as { id: string }[];

  for (const t of orphanedTasks) {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  }

  // 5. Remove orphaned sessions (no tasks)
  const orphanedSessions = db.prepare(`
    SELECT s.id FROM sessions s
    LEFT JOIN tasks t ON t.session_id = s.id
    WHERE t.id IS NULL AND s.ended_at IS NOT NULL
  `).all() as { id: string }[];

  for (const s of orphanedSessions) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
  }

  const totalOrphans = orphanedCheckpoints.length + emptyCheckpoints.length + orphanedTasks.length + orphanedSessions.length;

  if (totalOrphans === 0) {
    console.log(dim('Nothing to clean up.'));
  } else {
    console.log(success(`Cleaned up:`));
    if (orphanedCheckpoints.length) console.log(dim(`  ${orphanedCheckpoints.length} orphaned checkpoints`));
    if (emptyCheckpoints.length) console.log(dim(`  ${emptyCheckpoints.length} empty checkpoints (no changes)`));
    if (orphanedTasks.length) console.log(dim(`  ${orphanedTasks.length} orphaned tasks`));
    if (orphanedSessions.length) console.log(dim(`  ${orphanedSessions.length} orphaned sessions`));
  }
}
