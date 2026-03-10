import { getRewindDir } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { listCheckpoints } from '../../core/checkpoint';
import { getTaskById } from '../../core/task-manager';
import { formatCheckpointLine, header, dim } from '../../utils/format';

export function listCommand(options: { limit?: number }): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);

  const limit = options.limit || 20;
  const checkpoints = listCheckpoints(rewindDir, limit);

  if (checkpoints.length === 0) {
    console.log(dim('No checkpoints yet.'));
    return;
  }

  console.log(header('Checkpoints'));
  console.log();

  let currentTaskId = '';
  for (const cp of checkpoints) {
    // Show task header when task changes
    if (cp.task_id !== currentTaskId) {
      currentTaskId = cp.task_id;
      const task = getTaskById(rewindDir, cp.task_id);
      if (task && task.name !== 'default') {
        console.log();
        console.log(header(`  Task: ${task.name}`));
      }
    }

    const filePaths = cp.files.map(f => f.file_path);
    const line = formatCheckpointLine(
      cp.sequence,
      cp.id,
      cp.tool_name || 'unknown',
      filePaths,
      cp.created_at
    );
    console.log(`  ${line}`);
  }

  console.log();
  console.log(dim(`Showing ${checkpoints.length} checkpoint(s)`));
}
