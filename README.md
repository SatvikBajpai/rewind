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

All data is stored locally in `.rewind/`:
- `rewind.db` — SQLite database (metadata, checkpoint records)
- `diffs/` — Gzipped file snapshots and patch files

Add `.rewind/` to your `.gitignore`.

## License

MIT
