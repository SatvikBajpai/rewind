export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  description   TEXT,
  metadata      TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  name          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  description   TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  created_at    TEXT NOT NULL,
  tool_name     TEXT,
  tool_input    TEXT,
  reasoning     TEXT,
  sequence      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoint_files (
  id              TEXT PRIMARY KEY,
  checkpoint_id   TEXT NOT NULL REFERENCES checkpoints(id),
  file_path       TEXT NOT NULL,
  diff_content    TEXT,
  snapshot_path   TEXT,
  content_hash    TEXT,
  file_existed    INTEGER NOT NULL DEFAULT 1,
  file_size       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_sequence ON checkpoints(sequence);
CREATE INDEX IF NOT EXISTS idx_checkpoint_files_checkpoint ON checkpoint_files(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_files_path ON checkpoint_files(file_path);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
`;
