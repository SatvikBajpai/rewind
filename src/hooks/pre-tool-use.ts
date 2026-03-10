#!/usr/bin/env node

/**
 * PreToolUse hook for Claude Code.
 * Snapshots files BEFORE a tool modifies them.
 * Reads hook event JSON from stdin, writes response to stdout.
 */

import { findRewindDir } from '../utils/config';
import { initializeDb } from '../storage/database';
import { createCheckpoint } from '../core/checkpoint';
import fs from 'fs';
import path from 'path';

interface HookInput {
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, any>;
}

function extractFilePaths(toolName: string, toolInput: Record<string, any>): string[] {
  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'Read':
      return toolInput.file_path ? [toolInput.file_path] : [];

    case 'MultiEdit':
      return toolInput.file_path ? [toolInput.file_path] : [];

    case 'Bash': {
      // Try to extract file paths from common commands
      const cmd = toolInput.command || '';
      const paths: string[] = [];

      // Match sed -i, mv, cp, rm patterns
      const patterns = [
        /sed\s+-i[^\s]*\s+(?:'[^']*'|"[^"]*"|[^\s]+)\s+([^\s;|&]+)/g,
        /(?:mv|cp|rm)\s+(?:-\w+\s+)*([^\s;|&]+)/g,
        />\s*([^\s;|&]+)/g,  // redirect
        />>\s*([^\s;|&]+)/g, // append
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

function getReasoningBuffer(rewindDir: string): string | undefined {
  const bufferPath = path.join(rewindDir, 'reasoning_buffer.txt');
  try {
    const content = fs.readFileSync(bufferPath, 'utf-8');
    fs.unlinkSync(bufferPath); // consume it
    return content || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  try {
    const input = fs.readFileSync(0, 'utf-8'); // stdin
    const event: HookInput = JSON.parse(input);

    // Only checkpoint file-mutating tools
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
    if (filePaths.length === 0 && event.tool_name !== 'Bash') {
      process.stdout.write('{}');
      return;
    }

    const reasoning = getReasoningBuffer(rewindDir);

    const checkpoint = createCheckpoint(
      rewindDir,
      event.tool_name,
      JSON.stringify(event.tool_input).slice(0, 2000), // truncate large inputs
      filePaths,
      reasoning
    );

    // Store checkpoint ID for PostToolUse to pick up
    const pendingPath = path.join(rewindDir, 'pending_checkpoint.txt');
    fs.writeFileSync(pendingPath, checkpoint.id);

    process.stdout.write('{}');
  } catch (err) {
    // Hooks must never crash — always exit cleanly
    process.stdout.write('{}');
  }
}

main();
