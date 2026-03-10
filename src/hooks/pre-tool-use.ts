#!/usr/bin/env node

/**
 * PreToolUse hook for Claude Code.
 * Snapshots files BEFORE a tool modifies them.
 * For Bash commands: saves an mtime map so post-hook can detect all changes.
 */

import { findRewindDir, getProjectRoot } from '../utils/config';
import { initializeDb } from '../storage/database';
import { createCheckpoint } from '../core/checkpoint';
import fs from 'fs';
import path from 'path';

interface HookInput {
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, any>;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.rewind', 'dist', 'build', '.next',
  '__pycache__', '.pytest_cache', 'venv', '.vscode', '.idea',
  'coverage', '.nyc_output', '.DS_Store',
]);

function extractFilePaths(toolName: string, toolInput: Record<string, any>): string[] {
  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'Read':
    case 'MultiEdit':
      return toolInput.file_path ? [toolInput.file_path] : [];

    case 'Bash': {
      // Extract what we can from the command, but we rely on post-hook mtime scan
      const cmd = toolInput.command || '';
      const paths: string[] = [];

      const patterns = [
        /sed\s+-i[^\s]*\s+(?:'[^']*'|"[^"]*"|[^\s]+)\s+([^\s;|&]+)/g,
        /(?:mv|cp|rm)\s+(?:-\w+\s+)*([^\s;|&]+)/g,
        />\s*([^\s;|&]+)/g,
        />>\s*([^\s;|&]+)/g,
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(cmd)) !== null) {
          const p = match[1];
          if (p && !p.startsWith('-') && !p.includes('$')) {
            const resolved = path.isAbsolute(p) ? p : path.resolve(p);
            paths.push(resolved);
          }
        }
      }

      return paths;
    }

    default:
      return [];
  }
}

/** Scan project and build mtime map for all files */
function buildMtimeMap(dir: string, result: Record<string, number>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name.length > 1) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      buildMtimeMap(fullPath, result);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        result[fullPath] = stat.mtimeMs;
      } catch {
        // skip
      }
    }
  }
}

function getReasoningBuffer(rewindDir: string): string | undefined {
  const bufferPath = path.join(rewindDir, 'reasoning_buffer.txt');
  try {
    const content = fs.readFileSync(bufferPath, 'utf-8');
    fs.unlinkSync(bufferPath);
    return content || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const event: HookInput = JSON.parse(input);

    const mutatingTools = ['Write', 'Edit', 'MultiEdit', 'Bash'];
    if (!mutatingTools.includes(event.tool_name)) {
      process.stdout.write('{}');
      return;
    }

    const rewindDir = findRewindDir();
    if (!rewindDir) {
      process.stdout.write('{}');
      return;
    }

    initializeDb(rewindDir);

    const filePaths = extractFilePaths(event.tool_name, event.tool_input);

    // For Bash: save mtime map so post-hook can detect ALL file changes
    if (event.tool_name === 'Bash') {
      const projectRoot = getProjectRoot(rewindDir);
      const mtimeMap: Record<string, number> = {};
      buildMtimeMap(projectRoot, mtimeMap);
      const mtimePath = path.join(rewindDir, 'pre_mtime_map.json');
      fs.writeFileSync(mtimePath, JSON.stringify(mtimeMap));
    }

    // For non-Bash with no files detected, skip
    if (filePaths.length === 0 && event.tool_name !== 'Bash') {
      process.stdout.write('{}');
      return;
    }

    const reasoning = getReasoningBuffer(rewindDir);

    // Store full command for Bash (not truncated)
    const toolInputStr = event.tool_name === 'Bash'
      ? JSON.stringify(event.tool_input).slice(0, 5000)
      : JSON.stringify(event.tool_input).slice(0, 2000);

    const checkpoint = createCheckpoint(
      rewindDir,
      event.tool_name,
      toolInputStr,
      filePaths,
      reasoning
    );

    // Store checkpoint ID + metadata for PostToolUse
    const pendingPath = path.join(rewindDir, 'pending_checkpoint.json');
    fs.writeFileSync(pendingPath, JSON.stringify({
      checkpointId: checkpoint.id,
      toolName: event.tool_name,
    }));

    process.stdout.write('{}');
  } catch (err) {
    process.stdout.write('{}');
  }
}

main();
