import { execSync } from 'child_process';
import { getRewindDir, getProjectRoot } from '../../utils/config';
import { initializeDb, getDb } from '../../storage/database';
import { listTasks, getActiveTask } from '../../core/task-manager';
import { success, error, dim, header } from '../../utils/format';
import type { Checkpoint, CheckpointFile } from '../../core/checkpoint';

interface ExportOptions {
  all?: boolean;
  taskId?: string;
}

function isGitRepo(projectRoot: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getTaskCheckpoints(rewindDir: string, taskId: string): (Checkpoint & { files: CheckpointFile[] })[] {
  const db = getDb(rewindDir);
  const checkpoints = db.prepare(
    'SELECT * FROM checkpoints WHERE task_id = ? ORDER BY sequence ASC'
  ).all(taskId) as Checkpoint[];

  return checkpoints.map(cp => {
    const files = db.prepare(
      'SELECT * FROM checkpoint_files WHERE checkpoint_id = ?'
    ).all(cp.id) as CheckpointFile[];
    return { ...cp, files };
  });
}

function getUniqueFilePaths(checkpoints: (Checkpoint & { files: CheckpointFile[] })[]): string[] {
  const paths = new Set<string>();
  for (const cp of checkpoints) {
    for (const f of cp.files) {
      paths.add(f.file_path);
    }
  }
  return [...paths];
}

function buildCommitMessage(taskName: string, checkpoints: (Checkpoint & { files: CheckpointFile[] })[]): string {
  const lines: string[] = [taskName, ''];

  // Collect unique reasoning
  const reasons = new Set<string>();
  for (const cp of checkpoints) {
    if (cp.reasoning) {
      reasons.add(cp.reasoning);
    }
  }

  if (reasons.size > 0) {
    lines.push('Context:');
    for (const r of reasons) {
      // Truncate long reasoning
      const truncated = r.length > 200 ? r.slice(0, 200) + '...' : r;
      lines.push(`- ${truncated}`);
    }
    lines.push('');
  }

  // Summary of changes
  const files = getUniqueFilePaths(checkpoints);
  lines.push(`Files changed: ${files.length}`);
  lines.push(`Checkpoints collapsed: ${checkpoints.length}`);

  return lines.join('\n');
}

function exportTask(rewindDir: string, taskId: string, taskName: string, projectRoot: string): boolean {
  const checkpoints = getTaskCheckpoints(rewindDir, taskId);

  if (checkpoints.length === 0) {
    console.log(dim(`  Skipping "${taskName}" — no checkpoints`));
    return false;
  }

  const filePaths = getUniqueFilePaths(checkpoints);

  // Stage all affected files
  for (const filePath of filePaths) {
    try {
      execSync(`git add "${filePath}"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      // File might have been deleted, try git rm
      try {
        execSync(`git rm --cached "${filePath}"`, { cwd: projectRoot, stdio: 'pipe' });
      } catch {
        // File not tracked, skip
      }
    }
  }

  // Check if there's anything staged
  try {
    execSync('git diff --cached --quiet', { cwd: projectRoot, stdio: 'pipe' });
    console.log(dim(`  Skipping "${taskName}" — no staged changes`));
    return false;
  } catch {
    // Good — there are staged changes
  }

  const message = buildCommitMessage(taskName, checkpoints);

  try {
    execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: projectRoot, stdio: 'pipe' });
    console.log(success(`  Exported "${taskName}" → git commit (${filePaths.length} files, ${checkpoints.length} checkpoints)`));
    return true;
  } catch (err: any) {
    console.log(error(`  Failed to export "${taskName}": ${err.message}`));
    return false;
  }
}

export function exportCommand(options: ExportOptions): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);
  const projectRoot = getProjectRoot(rewindDir);

  if (!isGitRepo(projectRoot)) {
    console.log(error('Not a git repository. Run `git init` first.'));
    process.exit(1);
  }

  // Check for uncommitted changes
  try {
    execSync('git diff --quiet && git diff --cached --quiet', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    console.log(error('You have uncommitted git changes. Commit or stash them first.'));
    process.exit(1);
  }

  console.log(header('Exporting to git'));
  console.log();

  if (options.taskId) {
    const db = getDb(rewindDir);
    const task = db.prepare('SELECT * FROM tasks WHERE id LIKE ?').get(`${options.taskId}%`) as any;
    if (!task) {
      console.log(error(`Task not found: ${options.taskId}`));
      process.exit(1);
    }
    exportTask(rewindDir, task.id, task.name, projectRoot);
  } else if (options.all) {
    const tasks = listTasks(rewindDir, 100);
    // Export oldest first
    const sorted = [...tasks].reverse();
    let exported = 0;
    for (const task of sorted) {
      if (exportTask(rewindDir, task.id, task.name, projectRoot)) {
        exported++;
      }
    }
    console.log();
    console.log(dim(`${exported} task(s) exported as git commits`));
  } else {
    // Export current/latest task
    const task = getActiveTask(rewindDir);
    if (!task) {
      const tasks = listTasks(rewindDir, 1);
      if (tasks.length === 0) {
        console.log(dim('No tasks to export.'));
        return;
      }
      exportTask(rewindDir, tasks[0].id, tasks[0].name, projectRoot);
    } else {
      exportTask(rewindDir, task.id, task.name, projectRoot);
    }
  }
}
