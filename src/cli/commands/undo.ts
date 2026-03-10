import { getRewindDir } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { rollbackCheckpoint, rollbackTask, rollbackSession, getLatestCheckpoint } from '../../core/checkpoint';
import { getActiveTask } from '../../core/task-manager';
import { getActiveSession } from '../../core/session';
import { success, error, dim } from '../../utils/format';

export function undoCommand(scope?: string): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);

  if (scope === 'task') {
    undoTask(rewindDir);
  } else if (scope === 'session') {
    undoSession(rewindDir);
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

  const restored = rollbackCheckpoint(rewindDir, latest.id);
  console.log(success(`Rolled back checkpoint ${latest.id.slice(0, 8)}`));
  for (const f of restored) {
    console.log(dim(`  restored: ${f}`));
  }
}

function undoTask(rewindDir: string): void {
  const task = getActiveTask(rewindDir);
  if (!task) {
    console.log(error('No active task to undo.'));
    return;
  }

  const restored = rollbackTask(rewindDir, task.id);
  if (restored.length === 0) {
    console.log(dim('No checkpoints in this task.'));
    return;
  }

  console.log(success(`Rolled back task "${task.name}" (${restored.length} files restored)`));
  for (const f of restored) {
    console.log(dim(`  restored: ${f}`));
  }
}

function undoSession(rewindDir: string): void {
  const session = getActiveSession(rewindDir);
  if (!session) {
    console.log(error('No active session to undo.'));
    return;
  }

  const restored = rollbackSession(rewindDir, session.id);
  if (restored.length === 0) {
    console.log(dim('No checkpoints in this session.'));
    return;
  }

  console.log(success(`Rolled back entire session (${restored.length} files restored)`));
  for (const f of restored) {
    console.log(dim(`  restored: ${f}`));
  }
}
