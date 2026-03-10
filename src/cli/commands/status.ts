import { getRewindDir } from '../../utils/config';
import { initializeDb, getDb } from '../../storage/database';
import { getActiveSession } from '../../core/session';
import { getActiveTask } from '../../core/task-manager';
import { header, dim, success } from '../../utils/format';
import { formatRelativeTime } from '../../utils/format';

export function statusCommand(): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);
  const db = getDb(rewindDir);

  const session = getActiveSession(rewindDir);
  const task = getActiveTask(rewindDir);

  const totalCheckpoints = (db.prepare('SELECT COUNT(*) as count FROM checkpoints').get() as { count: number }).count;
  const totalTasks = (db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }).count;
  const totalSessions = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;

  console.log(header('rewind status'));
  console.log();

  if (session) {
    console.log(`  Session:      ${success('active')} ${dim(`(started ${formatRelativeTime(session.started_at)})`)}`);
  } else {
    console.log(`  Session:      ${dim('none')}`);
  }

  if (task) {
    console.log(`  Active task:  ${task.name} ${dim(`(started ${formatRelativeTime(task.started_at)})`)}`);
  } else {
    console.log(`  Active task:  ${dim('none')}`);
  }

  console.log();
  console.log(`  Checkpoints:  ${totalCheckpoints}`);
  console.log(`  Tasks:        ${totalTasks}`);
  console.log(`  Sessions:     ${totalSessions}`);
  console.log(`  Storage:      ${rewindDir}`);
}
