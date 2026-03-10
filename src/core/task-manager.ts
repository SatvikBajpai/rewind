import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../storage/database';
import { getOrCreateSession } from './session';

export interface Task {
  id: string;
  session_id: string;
  name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  description: string | null;
}

export function startTask(rewindDir: string, name: string, description?: string): Task {
  const db = getDb(rewindDir);
  const session = getOrCreateSession(rewindDir);

  // End any currently active task
  const activeTask = getActiveTask(rewindDir);
  if (activeTask) {
    endTask(rewindDir, activeTask.id);
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO tasks (id, session_id, name, started_at, status, description) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, session.id, name, now, 'active', description || null);

  return { id, session_id: session.id, name, started_at: now, ended_at: null, status: 'active', description: description || null };
}

export function endTask(rewindDir: string, taskId: string): void {
  const db = getDb(rewindDir);
  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET ended_at = ?, status = ? WHERE id = ?').run(now, 'completed', taskId);
}

export function getActiveTask(rewindDir: string): Task | null {
  const db = getDb(rewindDir);
  return (db.prepare(
    "SELECT * FROM tasks WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
  ).get() as Task) || null;
}

export function getOrCreateDefaultTask(rewindDir: string): Task {
  const existing = getActiveTask(rewindDir);
  if (existing) return existing;
  return startTask(rewindDir, 'default');
}

export function listTasks(rewindDir: string, limit = 20): Task[] {
  const db = getDb(rewindDir);
  return db.prepare('SELECT * FROM tasks ORDER BY started_at DESC LIMIT ?').all(limit) as Task[];
}

export function getTaskById(rewindDir: string, taskId: string): Task | null {
  const db = getDb(rewindDir);
  return (db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task) || null;
}
