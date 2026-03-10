import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../storage/database';

export interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  description: string | null;
  metadata: string | null;
}

export function startSession(rewindDir: string, description?: string): Session {
  const db = getDb(rewindDir);
  const id = process.env.CLAUDE_SESSION_ID || uuidv4();
  const now = new Date().toISOString();

  // Check if session already exists (resuming)
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  if (existing) return existing;

  const metadata = JSON.stringify({
    cwd: process.cwd(),
    node_version: process.version,
  });

  db.prepare(
    'INSERT INTO sessions (id, started_at, description, metadata) VALUES (?, ?, ?, ?)'
  ).run(id, now, description || null, metadata);

  return { id, started_at: now, ended_at: null, description: description || null, metadata };
}

export function endSession(rewindDir: string, sessionId: string): void {
  const db = getDb(rewindDir);
  const now = new Date().toISOString();
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(now, sessionId);
}

export function getActiveSession(rewindDir: string): Session | null {
  const db = getDb(rewindDir);
  return (db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get() as Session) || null;
}

export function getOrCreateSession(rewindDir: string): Session {
  const existing = getActiveSession(rewindDir);
  if (existing) return existing;
  return startSession(rewindDir);
}

export function listSessions(rewindDir: string, limit = 10): Session[] {
  const db = getDb(rewindDir);
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit) as Session[];
}
