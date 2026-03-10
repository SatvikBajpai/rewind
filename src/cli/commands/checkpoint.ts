import fs from 'fs';
import path from 'path';
import { getRewindDir, getProjectRoot } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { createCheckpoint } from '../../core/checkpoint';
import { success, error, dim } from '../../utils/format';

interface CheckpointOptions {
  message?: string;
}

/**
 * Manual checkpoint: snapshots current state of specified files.
 * Unlike hook-based checkpoints (which capture before+after), manual checkpoints
 * just record "here's what these files look like right now." Undo will restore
 * to this state.
 *
 * The trick: we DON'T call recordPostState. The snapshot IS the state we want
 * to be able to restore to. The diff is computed as "new file" since there's no
 * prior checkpoint for comparison.
 */
export function checkpointCommand(files: string[], options: CheckpointOptions): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);
  const projectRoot = getProjectRoot(rewindDir);

  if (files.length === 0) {
    console.log(error('Specify files to checkpoint: rewind checkpoint file1.ts file2.ts'));
    process.exit(1);
  }

  const resolvedFiles = files.map(f => path.isAbsolute(f) ? f : path.resolve(f));

  const missing = resolvedFiles.filter(f => !fs.existsSync(f));
  if (missing.length > 0) {
    console.log(error('Files not found:'));
    missing.forEach(f => console.log(dim(`  ${f}`)));
    process.exit(1);
  }

  const msg = options.message || 'manual checkpoint';

  // createCheckpoint snapshots current file contents (gzipped).
  // We intentionally skip recordPostState — the snapshot IS the restore point.
  const cp = createCheckpoint(
    rewindDir,
    'manual',
    JSON.stringify({ files: resolvedFiles.map(f => path.relative(projectRoot, f)) }),
    resolvedFiles,
    msg
  );

  console.log(success(`Checkpoint ${cp.id.slice(0, 8)} created`));
  resolvedFiles.forEach(f => {
    console.log(dim(`  ${path.relative(projectRoot, f)}`));
  });
  if (options.message) {
    console.log(dim(`  "${options.message}"`));
  }
}
