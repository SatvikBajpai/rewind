#!/usr/bin/env node

/**
 * PostToolUse hook for Claude Code.
 * Records diffs AFTER a tool has modified files.
 * Reads hook event JSON from stdin, writes response to stdout.
 */

import { findRewindDir } from '../utils/config';
import { initializeDb } from '../storage/database';
import { recordPostState } from '../core/checkpoint';
import fs from 'fs';
import path from 'path';

async function main() {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const event = JSON.parse(input);

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

    // Read pending checkpoint ID from PreToolUse
    const pendingPath = path.join(rewindDir, 'pending_checkpoint.txt');
    let checkpointId: string;
    try {
      checkpointId = fs.readFileSync(pendingPath, 'utf-8').trim();
      fs.unlinkSync(pendingPath);
    } catch {
      process.stdout.write('{}');
      return;
    }

    recordPostState(rewindDir, checkpointId);

    process.stdout.write('{}');
  } catch (err) {
    process.stdout.write('{}');
  }
}

main();
