# rewind

Agent-native version control. Auto-checkpoints every AI agent action with reasoning, semantic diffs, and instant rollback.

## Why

Git was built for humans. Agents make dozens of small changes per task, lose reasoning context, and produce noisy commit histories. **rewind** captures every file change automatically, stores the agent's reasoning alongside diffs, and lets you roll back by action, task, or entire session.

## Install

```bash
npm install -g rewind-vcs
```

## Quick Start

```bash
# Initialize in your project
cd your-project
rewind init

# Set up Claude Code hooks
rewind setup
# Copy the output into ~/.claude/settings.json

# Use Claude Code normally — every file change is auto-checkpointed

# See what happened
rewind list
rewind diff
rewind status

# Roll back
rewind undo              # undo last change
rewind undo task         # undo entire current task
rewind undo session      # undo everything in this session

# Manage tasks
rewind task start "add authentication"
rewind task list
rewind task current
```

## How It Works

rewind hooks into Claude Code's lifecycle events:

1. **PreToolUse** — Before a file is modified, rewind snapshots the current state (gzipped)
2. **PostToolUse** — After modification, rewind computes and stores the diff
3. **UserPromptSubmit** — Captures your prompt as reasoning context for the next checkpoint
4. **Stop** — Cleanly ends the session when the conversation stops

Every checkpoint stores:
- Which files changed
- Full before-snapshot (for reliable rollback)
- Unified diff (for readable history)
- Agent reasoning (what the user asked for)
- Tool name and input
- Task grouping

## Commands

| Command | Description |
|---------|-------------|
| `rewind init` | Initialize rewind in current directory |
| `rewind list` | Show timeline of checkpoints |
| `rewind diff [id]` | Show diff for a checkpoint (defaults to latest) |
| `rewind undo` | Rollback last checkpoint |
| `rewind undo task` | Rollback entire current task |
| `rewind undo session` | Rollback to session start |
| `rewind task start "name"` | Start a named task |
| `rewind task list` | List all tasks |
| `rewind task current` | Show active task |
| `rewind status` | Show current state |
| `rewind setup` | Print Claude Code hook configuration |

## Storage

All data is stored locally in `.rewind/` at your project root:

```
.rewind/
├── rewind.db                        # SQLite database (all metadata)
├── reasoning_buffer.txt             # Temp: holds last user prompt until next checkpoint
└── diffs/
    └── <checkpoint-id>/
        ├── <hash>.snapshot.gz       # Gzipped full file copy (before state)
        └── <hash>.patch             # Unified diff (what changed)
```

### Database Schema

SQLite with WAL mode for concurrent hook writes:

- **sessions** — One per Claude Code conversation (start/end time, cwd, metadata)
- **tasks** — Logical groups within a session ("add auth", "fix login bug")
- **checkpoints** — One per tool call (tool name, input, reasoning, sequence number)
- **checkpoint_files** — Files affected by each checkpoint (path, hash, size, pointers to snapshot/diff files)

### How Snapshots Work

- **Pre-snapshots** (`.snapshot.gz`) — Full gzipped copy of the file *before* the change. This is what gets restored on `rewind undo`. Gzip keeps storage small (~20-30% of original).
- **Patches** (`.patch`) — Unified diff computed after the change. This is what `rewind diff` displays.
- **Reasoning buffer** — Your last prompt is captured via the `UserPromptSubmit` hook and attached to the next checkpoint, linking *why* you asked for the change to *what* changed.

### Browsing Data

```bash
# Query the database directly
sqlite3 .rewind/rewind.db "SELECT id, tool_name, reasoning FROM checkpoints ORDER BY sequence DESC LIMIT 5;"

# See stored snapshots
ls .rewind/diffs/

# Decompress a snapshot
gunzip -c .rewind/diffs/<checkpoint-id>/<hash>.snapshot.gz
```

Add `.rewind/` to your `.gitignore`.

## License

MIT
