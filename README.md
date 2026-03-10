# rewind

Agent-native version control. Auto-checkpoints every AI agent action with reasoning, semantic diffs, and instant rollback.

**Works with:** Claude Code (auto) | Cursor (watch mode) | Aider | Windsurf | Any agent

---

## Why

Git was built for humans. AI agents:
- Make 50+ small changes per task — git history becomes noise
- Lose reasoning context — *why* was this change made?
- Can't easily roll back — you want "undo the last thing the agent did", not `git revert abc123`
- Don't group changes by intent — a task like "add auth" spans dozens of file touches

**rewind** solves this. Every file change is auto-checkpointed with the reasoning that caused it. Roll back by action, task, or entire session.

---

## Install

```bash
npm install -g rewind-vcs
```

---

## Quick Start

### With Claude Code (automatic)

```bash
# 1. Initialize in your project
cd my-project
rewind init

# 2. Set up hooks (auto-checkpoints every Claude Code action)
rewind setup
# Copy the output into ~/.claude/settings.json

# 3. Use Claude Code normally — every file change is captured
# 4. Open the dashboard
rewind ui
```

### With Cursor / Aider / Any Agent (watch mode)

```bash
# 1. Initialize
cd my-project
rewind init

# 2. Start watching for file changes
rewind watch

# 3. Use your agent in another terminal — rewind catches every file change
# 4. Open the dashboard
rewind ui
```

### Manual Checkpoints

```bash
# Checkpoint specific files manually
rewind checkpoint src/auth.ts src/routes.ts -m "added JWT auth"

# Works great for selective tracking
```

---

## Commands

### Core

| Command | Description |
|---------|-------------|
| `rewind init [dir]` | Initialize rewind in a project directory |
| `rewind status` | Show current session, task, and checkpoint counts |
| `rewind list` | Show timeline of recent checkpoints |
| `rewind diff [id]` | Show diff for a checkpoint (defaults to latest) |

### Rollback

| Command | Description |
|---------|-------------|
| `rewind undo` | Undo the last checkpoint (restores files) |
| `rewind undo task` | Undo everything in the current task |
| `rewind undo session` | Nuclear — undo everything in the current session |

### Tasks

| Command | Description |
|---------|-------------|
| `rewind task start "name"` | Start a named task (groups checkpoints) |
| `rewind task list` | List all tasks with checkpoint counts |
| `rewind task current` | Show the active task |

### Integration

| Command | Description |
|---------|-------------|
| `rewind watch` | Watch mode — auto-checkpoint on file changes (any agent) |
| `rewind checkpoint <files>` | Manually checkpoint specific files |
| `rewind export` | Export current task as a clean git commit |
| `rewind export --all` | Export all tasks as git commits |
| `rewind setup` | Print Claude Code hook configuration |

### Dashboard

| Command | Description |
|---------|-------------|
| `rewind ui` | Open the web dashboard (default: http://localhost:3333) |
| `rewind ui -p 4000` | Open on a custom port |

---

## Usage Examples

### Example 1: Basic workflow with Claude Code

```bash
$ cd my-app
$ rewind init
Initialized rewind in /Users/you/my-app/.rewind

$ rewind setup
# (copy hooks config to ~/.claude/settings.json)

# Now use Claude Code normally...
# Claude creates auth.ts, edits routes.ts, modifies app.ts

$ rewind list
Checkpoints

  Task: add authentication

  a1b5f9e1 Write    auth.ts                    2m ago
  c3d7e2f4 Edit     routes.ts                  1m ago
  e5f9a3b6 Edit     app.ts                     30s ago

Showing 3 checkpoint(s)

$ rewind diff a1b5f9e1
Checkpoint a1b5f9e1
Tool: Write | 2 minutes ago

--- /dev/null
+++ src/auth.ts
@@ -0,0 +1,25 @@
+import jwt from 'jsonwebtoken';
+
+export function validateToken(token: string) {
+  return jwt.verify(token, process.env.JWT_SECRET);
+}
```

### Example 2: Undo a bad change

```bash
# Agent made a change you don't like
$ rewind undo
Rolled back checkpoint e5f9a3b6
  restored: src/app.ts

# Undo the entire task
$ rewind undo task
Rolled back task "add authentication" (3 files restored)
  restored: src/auth.ts
  restored: src/routes.ts
  restored: src/app.ts
```

### Example 3: Using with Cursor

```bash
# Terminal 1: Start watching
$ rewind watch
Watching for file changes...
Project: /Users/you/my-app
Tracking 47 files
Works with any agent (Cursor, Aider, Windsurf, etc.)

# Terminal 2: Open the dashboard
$ rewind ui

# Use Cursor normally — every file change appears in rewind
# Watch output:
14:32:01 modified src/auth.ts a1b5f9e1
14:32:03 modified src/routes.ts c3d7e2f4
14:32:15 created  src/middleware/validate.ts e5f9a3b6
```

### Example 4: Task management

```bash
# Start a named task before asking the agent to work
$ rewind task start "add user authentication"
Started task: "add user authentication"

# ... agent makes changes ...

$ rewind task start "fix login bug"
Started task: "fix login bug"

# ... agent makes more changes ...

$ rewind task list
Tasks

  active   fix login bug            (3 checkpoints, 1m ago)
  completed add user authentication (8 checkpoints, 15m ago)

# Undo just the bugfix
$ rewind undo task
Rolled back task "fix login bug" (2 files restored)
```

### Example 5: Export to git

```bash
# After a task is done, export as a clean git commit
$ rewind export
Exported "add user authentication" → git commit (5 files, 8 checkpoints)

# Or export all tasks
$ rewind export --all
  Exported "add user authentication" → git commit (5 files, 8 checkpoints)
  Exported "fix login bug" → git commit (2 files, 3 checkpoints)

2 task(s) exported as git commits

# The commit message includes reasoning context:
$ git log -1
add user authentication

Context:
- add JWT-based auth to the express app
- make sure all routes are protected

Files changed: 5
Checkpoints collapsed: 8
```

### Example 6: Manual checkpoints

```bash
# Checkpoint files before a risky refactor
$ rewind checkpoint src/database.ts src/models/*.ts -m "before schema migration"
Checkpoint f7a2b3c4 created
  database.ts
  user.ts
  post.ts
  "before schema migration"

# If something goes wrong
$ rewind undo
Rolled back checkpoint f7a2b3c4
  restored: src/database.ts
  restored: src/models/user.ts
  restored: src/models/post.ts
```

---

## Dashboard

Run `rewind ui` to open the web dashboard at http://localhost:3333.

**Features:**
- GitHub-style commit history grouped by task
- Click any checkpoint to expand its full diff
- Filter by tool type (Write / Edit / Bash)
- Filter by session or task (click in the sidebar)
- Live auto-refresh (updates every 5 seconds)
- Tool breakdown chart
- Most-touched files list
- Session timeline with active/ended status

---

## How It Works

### Claude Code (automatic mode)

rewind hooks into Claude Code's lifecycle events:

```
User prompt → [UserPromptSubmit hook captures reasoning]
            → Agent calls Write/Edit/Bash
            → [PreToolUse hook snapshots files before change]
            → Tool executes
            → [PostToolUse hook records diff after change]
            → Agent finishes
            → [Stop hook ends session]
```

### Watch mode (any agent)

```
rewind watch polls for file changes every 1 second
            → detects modified/created files via mtime comparison
            → snapshots before-state and records diff
            → works with Cursor, Aider, Windsurf, or any tool
```

### What gets stored per checkpoint

| Field | Description |
|-------|-------------|
| `id` | Unique checkpoint ID (shown as 8-char prefix) |
| `task_id` | Which task this belongs to |
| `session_id` | Which session this belongs to |
| `tool_name` | Write, Edit, Bash, MultiEdit, watch, manual |
| `tool_input` | What the tool was asked to do (truncated) |
| `reasoning` | User's prompt that triggered this change |
| `sequence` | Ordering within the session |
| `files` | List of files with snapshots and diffs |

---

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

- **sessions** — One per agent conversation (start/end time, cwd, metadata)
- **tasks** — Logical groups within a session ("add auth", "fix login bug")
- **checkpoints** — One per tool call (tool name, input, reasoning, sequence number)
- **checkpoint_files** — Files affected per checkpoint (path, hash, size, snapshot + diff paths)

### How Snapshots Work

- **Pre-snapshots** (`.snapshot.gz`) — Full gzipped copy of the file *before* the change. This is what gets restored on `rewind undo`. Gzip keeps storage small (~20-30% of original).
- **Patches** (`.patch`) — Unified diff computed after the change. This is what `rewind diff` displays.
- **Reasoning buffer** — Your last prompt is captured and attached to the next checkpoint, linking *why* to *what*.

### Browsing Data

```bash
# Query the database directly
sqlite3 .rewind/rewind.db "SELECT id, tool_name, reasoning FROM checkpoints ORDER BY sequence DESC LIMIT 5;"

# See stored snapshots
ls .rewind/diffs/

# Decompress a snapshot to see the original file
gunzip -c .rewind/diffs/<checkpoint-id>/<hash>.snapshot.gz
```

Add `.rewind/` to your `.gitignore`.

---

## Edge Cases

### What if the agent modifies a file rewind doesn't track?

In Claude Code hook mode, rewind tracks all files passed to Write/Edit/MultiEdit tools. For Bash commands, it parses common file-modifying patterns (`sed -i`, `mv`, `cp`, `rm`, `>` redirects). Some edge cases may be missed — use `rewind watch` alongside hooks for maximum coverage.

### What about binary files?

Snapshots are stored as raw gzipped bytes, so binary files (images, compiled files) are captured. However, `rewind diff` won't show meaningful diffs for binary files.

### What if I undo and the file has been modified since?

`rewind undo` restores the file to exactly the state it was in before the checkpointed change. If the file has been modified again after the checkpoint, those later changes will be overwritten. Use `rewind list` to verify which checkpoint you're undoing.

### What about very large files?

Snapshots are gzipped. A 100KB source file compresses to ~20-30KB. For very large files (10MB+), checkpoints will be larger but still work. Consider adding large files to `.rewindignore` (coming soon).

### Can I use rewind without any agent?

Yes. Use `rewind checkpoint` to manually snapshot files before making changes, and `rewind undo` to roll back. It's a lightweight alternative to git stash.

### What happens if hooks crash?

Hooks are designed to never crash — all errors are caught and the hook exits cleanly with `{}`. If a hook does fail, the agent continues normally, you just miss that checkpoint.

### Can I run rewind in CI/CD?

Not designed for CI/CD. rewind is a local development tool. Use `rewind export` to produce clean git commits for your CI pipeline.

---

## Agent Compatibility

| Agent | Integration | How |
|-------|------------|-----|
| **Claude Code** | Automatic | `rewind setup` → hooks capture every action |
| **Cursor** | Watch mode | `rewind watch` → detects file changes |
| **Aider** | Watch mode | `rewind watch` → detects file changes |
| **Windsurf** | Watch mode | `rewind watch` → detects file changes |
| **Copilot** | Watch mode | `rewind watch` → detects file changes |
| **Any editor/agent** | Manual | `rewind checkpoint <files>` |

---

## License

MIT
