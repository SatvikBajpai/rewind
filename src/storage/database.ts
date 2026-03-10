import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA_SQL } from './schema';

let db: Database.Database | null = null;

export function getDb(rewindDir: string): Database.Database {
  if (db) return db;

  const dbPath = path.join(rewindDir, 'rewind.db');
  db = new Database(dbPath);

  // Performance + concurrency settings
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.pragma('foreign_keys = ON');

  return db;
}

export function initializeDb(rewindDir: string): void {
  const database = getDb(rewindDir);
  database.exec(SCHEMA_SQL);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
