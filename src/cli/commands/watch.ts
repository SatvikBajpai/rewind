import fs from 'fs';
import path from 'path';
import { getRewindDir, getProjectRoot } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { createCheckpoint, recordPostState } from '../../core/checkpoint';
import { success, dim } from '../../utils/format';

interface WatchOptions {
  ignore?: string;
}

const DEFAULT_IGNORE = [
  'node_modules', '.git', '.rewind', 'dist', 'build', '.next',
  '.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.env', '.env.local', '__pycache__', '.pytest_cache', 'venv',
  '.vscode', '.idea', 'coverage', '.nyc_output', 'tmp',
];

export function watchCommand(options: WatchOptions): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);
  const projectRoot = getProjectRoot(rewindDir);

  const extraIgnore = options.ignore ? options.ignore.split(',').map(s => s.trim()) : [];
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...extraIgnore]);

  // Build initial mtime map
  const mtimeMap = new Map<string, number>();
  scanDir(projectRoot, ignoreSet, mtimeMap);

  console.log(success('Watching for file changes...'));
  console.log(dim(`Project: ${projectRoot}`));
  console.log(dim(`Tracking ${mtimeMap.size} files`));
  console.log(dim('Works with any agent (Cursor, Aider, Windsurf, etc.)'));
  console.log(dim('Press Ctrl+C to stop.\n'));

  // Poll every 1 second
  setInterval(() => {
    const newMap = new Map<string, number>();
    scanDir(projectRoot, ignoreSet, newMap);

    const changed: string[] = [];
    const created: string[] = [];

    // Check for modified or new files
    for (const [filePath, mtime] of newMap) {
      const oldMtime = mtimeMap.get(filePath);
      if (oldMtime === undefined) {
        created.push(filePath);
      } else if (mtime > oldMtime) {
        changed.push(filePath);
      }
    }

    // Check for deleted files
    const deleted: string[] = [];
    for (const [filePath] of mtimeMap) {
      if (!newMap.has(filePath)) {
        deleted.push(filePath);
      }
    }

    const allAffected = [...changed, ...created];

    if (allAffected.length > 0) {
      // Create checkpoint for changed files
      const cp = createCheckpoint(
        rewindDir,
        'watch',
        JSON.stringify({ changed, created }),
        allAffected,
        `File change detected: ${allAffected.map(f => path.relative(projectRoot, f)).join(', ')}`
      );
      recordPostState(rewindDir, cp.id);

      const rel = (f: string) => path.relative(projectRoot, f);
      const timestamp = new Date().toLocaleTimeString();

      for (const f of changed) {
        console.log(`${dim(timestamp)} ${success('modified')} ${rel(f)} ${dim(cp.id.slice(0, 8))}`);
      }
      for (const f of created) {
        console.log(`${dim(timestamp)} ${success('created')}  ${rel(f)} ${dim(cp.id.slice(0, 8))}`);
      }
    }

    // Update the map
    mtimeMap.clear();
    for (const [k, v] of newMap) { mtimeMap.set(k, v); }
  }, 1000);
}

function scanDir(dir: string, ignoreSet: Set<string>, result: Map<string, number>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignoreSet.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanDir(fullPath, ignoreSet, result);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        result.set(fullPath, stat.mtimeMs);
      } catch {
        // Skip unreadable files
      }
    }
  }
}
