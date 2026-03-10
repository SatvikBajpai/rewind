import http from 'http';
import { getRewindDir } from '../../utils/config';
import { initializeDb, getDb } from '../../storage/database';
import { success, dim } from '../../utils/format';
import type { Checkpoint, CheckpointFile } from '../../core/checkpoint';

interface UIOptions {
  port?: string;
}

function getApiData(rewindDir: string) {
  const db = getDb(rewindDir);

  const sessions = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 20').all();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY started_at DESC LIMIT 50').all();
  const checkpoints = db.prepare('SELECT * FROM checkpoints ORDER BY sequence DESC LIMIT 100').all() as Checkpoint[];

  const checkpointsWithFiles = checkpoints.map(cp => {
    const files = db.prepare('SELECT * FROM checkpoint_files WHERE checkpoint_id = ?').all(cp.id) as CheckpointFile[];
    return { ...cp, files };
  });

  const stats = {
    totalCheckpoints: (db.prepare('SELECT COUNT(*) as c FROM checkpoints').get() as any).c,
    totalTasks: (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c,
    totalSessions: (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c,
  };

  return { sessions, tasks, checkpoints: checkpointsWithFiles, stats };
}

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>rewind — timeline</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    background: #0a0a0a;
    color: #e0e0e0;
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }
  h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 8px;
    color: #fff;
  }
  h1 span { color: #22c55e; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
  .stats {
    display: flex;
    gap: 24px;
    margin-bottom: 32px;
  }
  .stat {
    background: #141414;
    border: 1px solid #222;
    border-radius: 12px;
    padding: 20px 28px;
    min-width: 160px;
  }
  .stat-value { font-size: 32px; font-weight: 700; color: #fff; }
  .stat-label { font-size: 12px; color: #666; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
  .section-title {
    font-size: 16px;
    font-weight: 600;
    color: #888;
    margin-bottom: 16px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .timeline {
    position: relative;
    padding-left: 32px;
    margin-bottom: 40px;
  }
  .timeline::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #222;
  }
  .checkpoint {
    position: relative;
    background: #141414;
    border: 1px solid #222;
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 12px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }
  .checkpoint:hover {
    border-color: #333;
    background: #1a1a1a;
  }
  .checkpoint::before {
    content: '';
    position: absolute;
    left: -28px;
    top: 22px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #22c55e;
    border: 2px solid #0a0a0a;
  }
  .checkpoint.tool-Edit::before { background: #f59e0b; }
  .checkpoint.tool-Bash::before { background: #ef4444; }
  .checkpoint.tool-Write::before { background: #22c55e; }
  .cp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .cp-id { color: #f59e0b; font-size: 13px; }
  .cp-time { color: #555; font-size: 12px; }
  .cp-tool {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }
  .cp-tool.Write { background: #052e16; color: #22c55e; }
  .cp-tool.Edit { background: #2d1600; color: #f59e0b; }
  .cp-tool.Bash { background: #2d0000; color: #ef4444; }
  .cp-tool.MultiEdit { background: #1a0033; color: #a855f7; }
  .cp-files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .cp-file {
    background: #1e1e1e;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    color: #999;
  }
  .cp-reasoning {
    margin-top: 10px;
    padding: 10px 14px;
    background: #0d1117;
    border-left: 3px solid #22c55e;
    border-radius: 4px;
    font-size: 13px;
    color: #8b949e;
    line-height: 1.5;
  }
  .diff-panel {
    display: none;
    margin-top: 12px;
    background: #0d1117;
    border-radius: 8px;
    padding: 16px;
    font-size: 13px;
    line-height: 1.6;
    overflow-x: auto;
    white-space: pre;
  }
  .diff-panel.open { display: block; }
  .diff-add { color: #3fb950; }
  .diff-del { color: #f85149; }
  .diff-hunk { color: #58a6ff; }
  .diff-meta { color: #555; }
  .task-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 6px;
    font-size: 11px;
    background: #1a1a2e;
    color: #7c7cf7;
    margin-left: 8px;
  }
  .task-group {
    margin-bottom: 8px;
    padding: 8px 0;
  }
  .task-group-name {
    font-size: 14px;
    font-weight: 600;
    color: #7c7cf7;
    margin-bottom: 12px;
    padding-left: 4px;
  }
  .empty {
    color: #444;
    text-align: center;
    padding: 60px 0;
    font-size: 16px;
  }
  .legend {
    display: flex;
    gap: 16px;
    margin-bottom: 20px;
    font-size: 12px;
    color: #666;
  }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .refresh-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #22c55e;
    color: #000;
    border: none;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .refresh-btn:hover { opacity: 0.8; }
</style>
</head>
<body>
  <h1><span>&#9658;</span> rewind</h1>
  <p class="subtitle">agent-native version control</p>

  <div class="stats" id="stats"></div>

  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background:#22c55e"></div> Write</div>
    <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> Edit</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div> Bash</div>
    <div class="legend-item"><div class="legend-dot" style="background:#a855f7"></div> MultiEdit</div>
  </div>

  <div class="section-title">Timeline</div>
  <div class="timeline" id="timeline"></div>

  <button class="refresh-btn" onclick="loadData()">Refresh</button>

<script>
function relativeTime(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function fileName(p) {
  return p.split('/').pop();
}

function formatDiff(diff) {
  if (!diff) return '<span class="diff-meta">no diff recorded</span>';
  return diff.split('\\n').map(line => {
    const escaped = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (line.startsWith('+') && !line.startsWith('+++'))
      return '<span class="diff-add">' + escaped + '</span>';
    if (line.startsWith('-') && !line.startsWith('---'))
      return '<span class="diff-del">' + escaped + '</span>';
    if (line.startsWith('@@'))
      return '<span class="diff-hunk">' + escaped + '</span>';
    if (line.startsWith('Index:') || line.startsWith('===') || line.startsWith('---') || line.startsWith('+++'))
      return '<span class="diff-meta">' + escaped + '</span>';
    return escaped;
  }).join('\\n');
}

function toggleDiff(id) {
  const el = document.getElementById('diff-' + id);
  el.classList.toggle('open');
}

function renderStats(stats) {
  document.getElementById('stats').innerHTML =
    '<div class="stat"><div class="stat-value">' + stats.totalCheckpoints + '</div><div class="stat-label">Checkpoints</div></div>' +
    '<div class="stat"><div class="stat-value">' + stats.totalTasks + '</div><div class="stat-label">Tasks</div></div>' +
    '<div class="stat"><div class="stat-value">' + stats.totalSessions + '</div><div class="stat-label">Sessions</div></div>';
}

function renderTimeline(data) {
  const timeline = document.getElementById('timeline');
  const cps = data.checkpoints;

  if (cps.length === 0) {
    timeline.innerHTML = '<div class="empty">No checkpoints yet. Start using Claude Code!</div>';
    return;
  }

  // Group by task
  const taskMap = {};
  for (const t of data.tasks) { taskMap[t.id] = t; }

  let html = '';
  let currentTaskId = '';

  for (const cp of cps) {
    if (cp.task_id !== currentTaskId) {
      currentTaskId = cp.task_id;
      const task = taskMap[cp.task_id];
      const name = task ? task.name : 'unknown';
      if (name !== 'default') {
        html += '<div class="task-group"><div class="task-group-name">Task: ' + name + '</div></div>';
      }
    }

    const toolClass = cp.tool_name || 'Write';
    html += '<div class="checkpoint tool-' + toolClass + '" onclick="toggleDiff(\\''+cp.id+'\\')">';
    html += '<div class="cp-header">';
    html += '<div><span class="cp-id">' + cp.id.slice(0,8) + '</span>';
    html += '<span class="cp-tool ' + toolClass + '">' + toolClass + '</span></div>';
    html += '<span class="cp-time">' + relativeTime(cp.created_at) + '</span>';
    html += '</div>';

    if (cp.files && cp.files.length > 0) {
      html += '<div class="cp-files">';
      for (const f of cp.files) {
        html += '<span class="cp-file">' + fileName(f.file_path) + '</span>';
      }
      html += '</div>';
    }

    if (cp.reasoning) {
      html += '<div class="cp-reasoning">' + cp.reasoning.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>';
    }

    // Diff panel
    html += '<div class="diff-panel" id="diff-' + cp.id + '">';
    if (cp.files) {
      for (const f of cp.files) {
        html += formatDiff(f.diff_content);
      }
    }
    html += '</div>';

    html += '</div>';
  }

  timeline.innerHTML = html;
}

async function loadData() {
  const res = await fetch('/api/data');
  const data = await res.json();
  renderStats(data.stats);
  renderTimeline(data);
}

loadData();
// Auto-refresh every 5s
setInterval(loadData, 5000);
</script>
</body>
</html>`;
}

export function uiCommand(options: UIOptions): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);

  const port = parseInt(options.port || '3333');

  const server = http.createServer((req, res) => {
    if (req.url === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      try {
        const data = getApiData(rewindDir);
        res.end(JSON.stringify(data));
      } catch (err: any) {
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getHTML());
    }
  });

  server.listen(port, () => {
    console.log(success(`rewind timeline running at http://localhost:${port}`));
    console.log(dim('Auto-refreshes every 5 seconds. Ctrl+C to stop.'));
  });
}
