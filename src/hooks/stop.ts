#!/usr/bin/env node

/**
 * Stop hook for Claude Code.
 * Ends the current session when the conversation stops.
 */

import { findRewindDir } from '../utils/config';
import { initializeDb } from '../storage/database';
import { getActiveSession, endSession } from '../core/session';
import { getActiveTask } from '../core/task-manager';
import { endTask } from '../core/task-manager';
import fs from 'fs';

async function main() {
  try {
    fs.readFileSync(0, 'utf-8'); // consume stdin

    const rewindDir = findRewindDir();
    if (!rewindDir) {
      process.stdout.write('{}');
      return;
    }

    initializeDb(rewindDir);

    // End active task
    const task = getActiveTask(rewindDir);
    if (task) {
      endTask(rewindDir, task.id);
    }

    // End active session
    const session = getActiveSession(rewindDir);
    if (session) {
      endSession(rewindDir, session.id);
    }

    process.stdout.write('{}');
  } catch {
    process.stdout.write('{}');
  }
}

main();
