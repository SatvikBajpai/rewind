import { createRewindDir, findRewindDir } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { success, error, dim } from '../../utils/format';

export function initCommand(dir?: string): void {
  const projectDir = dir || process.cwd();

  const existing = findRewindDir(projectDir);
  if (existing) {
    console.log(error(`Already initialized at ${existing}`));
    process.exit(1);
  }

  const rewindDir = createRewindDir(projectDir);
  initializeDb(rewindDir);

  console.log(success('Initialized rewind in ' + rewindDir));
  console.log(dim('Checkpoints will be stored here. Add .rewind/ to your .gitignore.'));
}
