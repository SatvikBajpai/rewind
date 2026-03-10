import fs from 'fs';
import path from 'path';
import { getRewindDir, getProjectRoot } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { createCheckpoint, recordPostState } from '../../core/checkpoint';
import { success, dim, error } from '../../utils/format';

interface WatchOptions {
  ignore?: string;
  interval?: string;
}

const DEFAULT_IGNORE = [
  'node_modules', '.git', '.rewind', 'dist', 'build', '.next',
  '.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.env', '.env.local', '__pycache__', '.pytest_cache', 'venv',
  '.vscode', '.idea', 'coverage', '.nyc_output', 'tmp',
];

interface FileState {
  mtime: number;
  size: number;
  contentHash: string;
}

export function watchCommand(options: WatchOptions): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);
  const projectRoot = getProjectRoot(rewindDir);
  const interval = parseInt(options.interval || '1000');

  const extraIgnore = options.ignore ? options.ignore.split(',').map(s => s.trim()) : [];
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...extraIgnore]);

  // Build initial state map with content hashes (not just mtimes)
  const stateMap = new Map<string, FileState>();
  scanDir(projectRoot, ignoreSet, stateMap);

  // Pre-snapshot all tracked files so we have true before-state
  // We store content in memory for files that change
  const contentCache = new Map<string, Buffer>();
  for (const [filePath] of stateMap) {
    try {
      contentCache.set(filePath, fs.readFileSync(filePath));
    } catch {
      // skip
    }
  }

  console.log(success('Watching for file changes...'));
  console.log(dim(`Project: ${projectRoot}`));
  console.log(dim(`Tracking ${stateMap.size} files (interval: ${interval}ms)`));
  console.log(dim('Works with any agent (Cursor, Aider, Windsurf, etc.)'));
  console.log(dim('Press Ctrl+C to stop.\n'));

  // Debounce: collect changes over a short window before checkpointing
  let pendingChanges: { type: 'modified' | 'created' | 'deleted'; path: string }[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;

  function flushChanges() {
    if (pendingChanges.length === 0) return;

    const changes = [...pendingChanges];
    pendingChanges = [];

    const created = changes.filter(c => c.type === 'created').map(c => c.path);
    const modified = changes.filter(c => c.type === 'modified').map(c => c.path);
    const deleted = changes.filter(c => c.type === 'deleted').map(c => c.path);
    const allAffected = [...modified, ...created];

    if (allAffected.length > 0) {
      // For modified files: write the cached before-state to a temp location
      // so createCheckpoint can snapshot it properly
      const tempRestores: { path: string; originalContent: Buffer }[] = [];

      for (const filePath of modified) {
        const cachedContent = contentCache.get(filePath);
        if (cachedContent) {
          // We have the true before-state in cache
          // Write it temporarily so createCheckpoint reads it
          const currentContent = safeReadFile(filePath);
          if (currentContent) {
            const tempPath = filePath + '.rewind-tmp';
            try {
              fs.writeFileSync(tempPath, cachedContent);
              fs.renameSync(tempPath, filePath); // atomic replace with old content
              tempRestores.push({ path: filePath, originalContent: currentContent });
            } catch {
              // fallback: just checkpoint current state
            }
          }
        }
      }

      // Create checkpoint (snapshots the before-state we just restored)
      const description = changes.map(c => {
        const rel = path.relative(projectRoot, c.path);
        return `${c.type}: ${rel}`;
      }).join(', ');

      const cp = createCheckpoint(
        rewindDir,
        'watch',
        JSON.stringify({ created, modified, deleted }),
        allAffected,
        description
      );

      // Restore the actual current content
      for (const restore of tempRestores) {
        try {
          fs.writeFileSync(restore.path, restore.originalContent);
        } catch {
          // This should not happen
        }
      }

      // Record post-state (current files)
      recordPostState(rewindDir, cp.id);

      const timestamp = new Date().toLocaleTimeString();

      for (const f of created) {
        console.log(`${dim(timestamp)} ${success('+ created')}  ${path.relative(projectRoot, f)} ${dim(cp.id.slice(0, 8))}`);
      }
      for (const f of modified) {
        console.log(`${dim(timestamp)} ${success('~ modified')} ${path.relative(projectRoot, f)} ${dim(cp.id.slice(0, 8))}`);
      }
      for (const f of deleted) {
        console.log(`${dim(timestamp)} ${error('- deleted')}  ${path.relative(projectRoot, f)}`);
      }
    }

    // Update content cache with current state
    for (const change of changes) {
      if (change.type === 'deleted') {
        contentCache.delete(change.path);
      } else {
        const content = safeReadFile(change.path);
        if (content) {
          contentCache.set(change.path, content);
        }
      }
    }
  }

  // Poll for changes
  setInterval(() => {
    const newStateMap = new Map<string, FileState>();
    scanDir(projectRoot, ignoreSet, newStateMap);

    // Check for modified or new files
    for (const [filePath, newState] of newStateMap) {
      const oldState = stateMap.get(filePath);

      if (!oldState) {
        pendingChanges.push({ type: 'created', path: filePath });
      } else if (newState.mtime > oldState.mtime || newState.size !== oldState.size) {
        // Double-check with content hash to avoid false positives
        if (newState.contentHash !== oldState.contentHash) {
          pendingChanges.push({ type: 'modified', path: filePath });
        }
      }
    }

    // Check for deleted files
    for (const [filePath] of stateMap) {
      if (!newStateMap.has(filePath)) {
        pendingChanges.push({ type: 'deleted', path: filePath });
      }
    }

    // Update state map
    stateMap.clear();
    for (const [k, v] of newStateMap) { stateMap.set(k, v); }

    // Debounce: wait 500ms of quiet before flushing
    if (pendingChanges.length > 0) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flushChanges, 500);
    }
  }, interval);
}

function safeReadFile(filePath: string): Buffer | null {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function quickHash(content: Buffer): string {
  // Fast hash using Node's built-in crypto
  const { createHash } = require('crypto');
  return createHash('md5').update(content).digest('hex');
}

function scanDir(dir: string, ignoreSet: Set<string>, result: Map<string, FileState>): void {
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
        const content = fs.readFileSync(fullPath);
        result.set(fullPath, {
          mtime: stat.mtimeMs,
          size: stat.size,
          contentHash: quickHash(content),
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
}
