import fs from 'fs';
import path from 'path';

const REWIND_DIR = '.rewind';

export function findRewindDir(startDir?: string): string | null {
  let dir = startDir || process.cwd();

  while (true) {
    const candidate = path.join(dir, REWIND_DIR);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached root
    dir = parent;
  }
}

export function getRewindDir(startDir?: string): string {
  const dir = findRewindDir(startDir);
  if (!dir) {
    throw new Error('Not a rewind project. Run `rewind init` first.');
  }
  return dir;
}

export function getProjectRoot(rewindDir: string): string {
  return path.dirname(rewindDir);
}

export function createRewindDir(projectDir: string): string {
  const rewindDir = path.join(projectDir, REWIND_DIR);
  fs.mkdirSync(rewindDir, { recursive: true });
  fs.mkdirSync(path.join(rewindDir, 'diffs'), { recursive: true });
  return rewindDir;
}
