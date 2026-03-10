import fs from 'fs';
import path from 'path';
import { findRewindDir } from './config';

/**
 * Debug logger that writes to .rewind/debug.log.
 * Never throws — hooks must never crash.
 */
export function debugLog(context: string, message: string, data?: any): void {
  try {
    const rewindDir = findRewindDir();
    if (!rewindDir) return;

    const logPath = path.join(rewindDir, 'debug.log');
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] [${context}] ${message}`;
    if (data !== undefined) {
      try {
        line += ' ' + JSON.stringify(data);
      } catch {
        line += ' [unserializable]';
      }
    }
    line += '\n';

    fs.appendFileSync(logPath, line);
  } catch {
    // Never crash
  }
}

export function debugError(context: string, err: unknown): void {
  const message = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  debugLog(context, `ERROR: ${message}`);
}
