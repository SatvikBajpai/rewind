#!/usr/bin/env node

/**
 * UserPromptSubmit hook for Claude Code.
 * Captures user prompt as reasoning context for the next checkpoint.
 */

import { findRewindDir } from '../utils/config';
import fs from 'fs';
import path from 'path';

async function main() {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const event = JSON.parse(input);

    const rewindDir = findRewindDir();
    if (!rewindDir) {
      process.stdout.write('{}');
      return;
    }

    // Store user prompt as reasoning buffer for the next checkpoint
    const prompt = event.user_prompt || '';
    if (prompt) {
      const bufferPath = path.join(rewindDir, 'reasoning_buffer.txt');
      fs.writeFileSync(bufferPath, prompt.slice(0, 1000)); // truncate long prompts
    }

    process.stdout.write('{}');
  } catch {
    process.stdout.write('{}');
  }
}

main();
