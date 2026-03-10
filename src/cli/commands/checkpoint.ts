import fs from 'fs';
import path from 'path';
import { getRewindDir, getProjectRoot } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { createCheckpoint, recordPostState } from '../../core/checkpoint';
import { success, error, dim } from '../../utils/format';

interface CheckpointOptions {
  message?: string;
  files?: string[];
}

export function checkpointCommand(files: string[], options: CheckpointOptions): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);
  const projectRoot = getProjectRoot(rewindDir);

  if (files.length === 0) {
    console.log(error('Specify files to checkpoint: rewind checkpoint file1.ts file2.ts'));
    console.log(dim('Or use --all to checkpoint all modified files.'));
    process.exit(1);
  }

  // Resolve file paths
  const resolvedFiles = files.map(f => path.isAbsolute(f) ? f : path.resolve(f));

  // Verify files exist
  const missing = resolvedFiles.filter(f => !fs.existsSync(f));
  if (missing.length > 0) {
    console.log(error('Files not found:'));
    missing.forEach(f => console.log(dim(`  ${f}`)));
    process.exit(1);
  }

  const msg = options.message || 'manual checkpoint';

  const cp = createCheckpoint(
    rewindDir,
    'manual',
    JSON.stringify({ files: resolvedFiles }),
    resolvedFiles,
    msg
  );

  // Immediately record post-state (files are already in their current state)
  recordPostState(rewindDir, cp.id);

  console.log(success(`Checkpoint ${cp.id.slice(0, 8)} created`));
  resolvedFiles.forEach(f => {
    const rel = path.relative(projectRoot, f);
    console.log(dim(`  ${rel}`));
  });
  if (options.message) {
    console.log(dim(`  "${options.message}"`));
  }
}
