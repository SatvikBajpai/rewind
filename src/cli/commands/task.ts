import { getRewindDir } from '../../utils/config';
import { initializeDb, getDb } from '../../storage/database';
import { startTask, listTasks, getActiveTask } from '../../core/task-manager';
import { header, dim, success, formatRelativeTime } from '../../utils/format';
import pc from 'picocolors';

export function taskCommand(action: string, name?: string): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);

  if (action === 'start') {
    if (!name) {
      console.log(pc.red('Task name required: rewind task start "description"'));
      process.exit(1);
    }
    const task = startTask(rewindDir, name);
    console.log(success(`Started task: "${task.name}"`));
  } else if (action === 'list') {
    taskListCommand(rewindDir);
  } else if (action === 'current') {
    const task = getActiveTask(rewindDir);
    if (task) {
      const db = getDb(rewindDir);
      const count = (db.prepare('SELECT COUNT(*) as count FROM checkpoints WHERE task_id = ?').get(task.id) as { count: number }).count;
      console.log(`Active task: ${task.name} (${count} checkpoints, started ${formatRelativeTime(task.started_at)})`);
    } else {
      console.log(dim('No active task.'));
    }
  } else {
    console.log(pc.red(`Unknown action: ${action}. Use: start, list, current`));
  }
}

function taskListCommand(rewindDir: string): void {
  const tasks = listTasks(rewindDir);
  const db = getDb(rewindDir);

  if (tasks.length === 0) {
    console.log(dim('No tasks yet.'));
    return;
  }

  console.log(header('Tasks'));
  console.log();

  for (const task of tasks) {
    const count = (db.prepare('SELECT COUNT(*) as count FROM checkpoints WHERE task_id = ?').get(task.id) as { count: number }).count;
    const status = task.status === 'active' ? pc.green('active') : pc.dim(task.status);
    console.log(`  ${status} ${task.name} ${dim(`(${count} checkpoints, ${formatRelativeTime(task.started_at)})`)}`);
  }
}
