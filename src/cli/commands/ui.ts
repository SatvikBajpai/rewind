import http from 'http';
import path from 'path';
import { getRewindDir, getProjectRoot } from '../../utils/config';
import { initializeDb, getDb } from '../../storage/database';
import { success, dim } from '../../utils/format';
import type { Checkpoint, CheckpointFile } from '../../core/checkpoint';

interface UIOptions {
  port?: string;
}

function getApiData(rewindDir: string) {
  const db = getDb(rewindDir);
  const projectRoot = getProjectRoot(rewindDir);

  const sessions = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 20').all() as any[];
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY started_at DESC LIMIT 50').all() as any[];
  const checkpoints = db.prepare('SELECT * FROM checkpoints ORDER BY sequence DESC LIMIT 200').all() as Checkpoint[];

  const checkpointsWithFiles = checkpoints.map(cp => {
    const files = db.prepare('SELECT * FROM checkpoint_files WHERE checkpoint_id = ?').all(cp.id) as CheckpointFile[];
    return { ...cp, files };
  });

  // Per-task checkpoint counts
  const taskCounts: Record<string, number> = {};
  for (const cp of checkpoints) {
    taskCounts[cp.task_id] = (taskCounts[cp.task_id] || 0) + 1;
  }

  // Per-session checkpoint counts
  const sessionCounts: Record<string, number> = {};
  for (const cp of checkpoints) {
    sessionCounts[cp.session_id] = (sessionCounts[cp.session_id] || 0) + 1;
  }

  // Tool breakdown
  const toolCounts: Record<string, number> = {};
  for (const cp of checkpoints) {
    const tool = cp.tool_name || 'unknown';
    toolCounts[tool] = (toolCounts[tool] || 0) + 1;
  }

  // Unique files touched
  const uniqueFiles = new Set<string>();
  for (const cp of checkpointsWithFiles) {
    for (const f of cp.files) {
      uniqueFiles.add(f.file_path);
    }
  }

  const stats = {
    totalCheckpoints: (db.prepare('SELECT COUNT(*) as c FROM checkpoints').get() as any).c,
    totalTasks: (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c,
    totalSessions: (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c,
    uniqueFiles: uniqueFiles.size,
    toolCounts,
  };

  return {
    project: { name: path.basename(projectRoot), root: projectRoot },
    sessions: sessions.map(s => ({ ...s, checkpointCount: sessionCounts[s.id] || 0 })),
    tasks: tasks.map(t => ({ ...t, checkpointCount: taskCounts[t.id] || 0 })),
    checkpoints: checkpointsWithFiles,
    stats,
  };
}

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>rewind</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #09090b;
    color: #e4e4e7;
    height: 100vh;
    overflow: hidden;
  }

  /* Layout: sidebar + main */
  .layout {
    display: grid;
    grid-template-columns: 300px 1fr;
    height: 100vh;
  }

  /* ── Sidebar ── */
  .sidebar {
    background: #0f0f12;
    border-right: 1px solid #1c1c22;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 20px 20px 16px;
    border-bottom: 1px solid #1c1c22;
  }

  .logo {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .logo-icon {
    width: 28px;
    height: 28px;
    background: #22c55e;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: #000;
    font-weight: 800;
  }

  .project-info {
    background: #16161a;
    border: 1px solid #1c1c22;
    border-radius: 10px;
    padding: 14px 16px;
  }

  .project-name {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 4px;
  }

  .project-path {
    font-size: 11px;
    color: #52525b;
    font-family: 'SF Mono', monospace;
    word-break: break-all;
  }

  /* Sidebar sections */
  .sidebar-section {
    padding: 16px 20px;
    border-bottom: 1px solid #1c1c22;
  }

  .sidebar-section-title {
    font-size: 10px;
    font-weight: 700;
    color: #52525b;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 12px;
  }

  /* Session cards */
  .session-card {
    padding: 10px 12px;
    border-radius: 8px;
    margin-bottom: 6px;
    cursor: pointer;
    transition: background 0.15s;
    border: 1px solid transparent;
  }

  .session-card:hover { background: #1c1c22; }
  .session-card.active { background: #1a1a2e; border-color: #3b3bf7; }

  .session-status {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 6px;
  }

  .session-status.live { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
  .session-status.ended { background: #3f3f46; }

  .session-time { font-size: 13px; color: #a1a1aa; }
  .session-meta { font-size: 11px; color: #52525b; margin-top: 2px; }

  /* Task list in sidebar */
  .task-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-radius: 8px;
    margin-bottom: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .task-item:hover { background: #1c1c22; }
  .task-item.active-filter { background: #1a1a2e; }

  .task-name { font-size: 13px; color: #d4d4d8; }

  .task-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
  }

  .task-status-dot.active { background: #22c55e; }
  .task-status-dot.completed { background: #3f3f46; }

  .task-count {
    font-size: 11px;
    color: #52525b;
    background: #1c1c22;
    padding: 2px 8px;
    border-radius: 10px;
  }

  /* Sidebar stats */
  .sidebar-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .sidebar-stat {
    background: #16161a;
    border-radius: 8px;
    padding: 12px;
    text-align: center;
  }

  .sidebar-stat-val {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
  }

  .sidebar-stat-label {
    font-size: 10px;
    color: #52525b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }

  /* Tool breakdown */
  .tool-bar {
    display: flex;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    margin-top: 12px;
    margin-bottom: 8px;
  }

  .tool-bar-seg { height: 100%; transition: width 0.3s; }

  .tool-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .tool-legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #71717a;
  }

  .tool-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .sidebar-scroll {
    flex: 1;
    overflow-y: auto;
  }

  .sidebar-scroll::-webkit-scrollbar { width: 4px; }
  .sidebar-scroll::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }

  /* ── Main Area ── */
  .main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .main-header {
    padding: 16px 28px;
    border-bottom: 1px solid #1c1c22;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #0c0c0f;
  }

  .main-title {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
  }

  .main-subtitle {
    font-size: 12px;
    color: #52525b;
    margin-top: 2px;
  }

  .filter-bar {
    display: flex;
    gap: 8px;
  }

  .filter-btn {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid #27272a;
    background: transparent;
    color: #a1a1aa;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }

  .filter-btn:hover { border-color: #3f3f46; color: #fff; }
  .filter-btn.active { background: #22c55e; color: #000; border-color: #22c55e; font-weight: 600; }

  /* Timeline */
  .main-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 20px 28px;
  }

  .main-scroll::-webkit-scrollbar { width: 6px; }
  .main-scroll::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }

  /* Task group */
  .task-group {
    margin-bottom: 28px;
  }

  .task-group-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #1c1c22;
  }

  .task-group-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: #1a1a2e;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: #818cf8;
  }

  .task-group-title { font-size: 14px; font-weight: 600; color: #c7d2fe; }

  .task-group-meta {
    font-size: 11px;
    color: #52525b;
    margin-left: auto;
  }

  .task-group-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .task-group-status.active { background: #052e16; color: #22c55e; }
  .task-group-status.completed { background: #1c1c22; color: #71717a; }

  /* Checkpoint row */
  .cp-row {
    display: grid;
    grid-template-columns: 40px 1fr;
    gap: 0;
    margin-bottom: 2px;
  }

  .cp-line {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .cp-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-top: 16px;
    flex-shrink: 0;
    z-index: 1;
  }

  .cp-dot.Write { background: #22c55e; }
  .cp-dot.Edit { background: #f59e0b; }
  .cp-dot.Bash { background: #ef4444; }
  .cp-dot.MultiEdit { background: #a855f7; }

  .cp-connector {
    width: 2px;
    flex: 1;
    background: #1c1c22;
  }

  .cp-card {
    background: #111114;
    border: 1px solid #1c1c22;
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .cp-card:hover {
    border-color: #27272a;
    background: #16161a;
  }

  .cp-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }

  .cp-tool-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
  }

  .cp-tool-badge.Write { background: #052e16; color: #4ade80; }
  .cp-tool-badge.Edit { background: #2d1600; color: #fbbf24; }
  .cp-tool-badge.Bash { background: #2d0000; color: #f87171; }
  .cp-tool-badge.MultiEdit { background: #1a0033; color: #c084fc; }

  .cp-id-badge {
    font-family: 'SF Mono', monospace;
    font-size: 11px;
    color: #52525b;
  }

  .cp-time-badge {
    font-size: 11px;
    color: #3f3f46;
    margin-left: auto;
  }

  .cp-files-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 6px;
  }

  .cp-file-tag {
    font-family: 'SF Mono', monospace;
    font-size: 11px;
    background: #1c1c22;
    color: #a1a1aa;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .cp-reasoning-box {
    margin-top: 10px;
    padding: 10px 14px;
    background: #0c1520;
    border-left: 3px solid #3b82f6;
    border-radius: 0 6px 6px 0;
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.5;
  }

  .cp-reasoning-label {
    font-size: 10px;
    font-weight: 700;
    color: #3b82f6;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }

  /* Diff panel */
  .diff-panel {
    display: none;
    margin-top: 10px;
    background: #0d1117;
    border: 1px solid #1c1c22;
    border-radius: 8px;
    overflow: hidden;
  }

  .diff-panel.open { display: block; }

  .diff-file-header {
    padding: 8px 14px;
    background: #161b22;
    border-bottom: 1px solid #1c1c22;
    font-family: 'SF Mono', monospace;
    font-size: 12px;
    color: #8b949e;
  }

  .diff-content {
    padding: 12px 14px;
    font-family: 'SF Mono', monospace;
    font-size: 12px;
    line-height: 1.7;
    overflow-x: auto;
    white-space: pre;
  }

  .diff-add { color: #3fb950; background: #0d2818; display: block; margin: 0 -14px; padding: 0 14px; }
  .diff-del { color: #f85149; background: #2d0000; display: block; margin: 0 -14px; padding: 0 14px; }
  .diff-hunk { color: #58a6ff; }
  .diff-meta { color: #484f58; }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 40px;
    color: #3f3f46;
  }

  .empty-state-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.3; }
  .empty-state-text { font-size: 15px; }

  /* Live indicator */
  .live-dot {
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
    display: inline-block;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .header-live {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #22c55e;
  }
</style>
</head>
<body>
<div class="layout">

  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <div class="logo-icon">R</div>
        rewind
      </div>
      <div class="project-info" id="project-info"></div>
    </div>

    <div class="sidebar-scroll">
      <div class="sidebar-section">
        <div class="sidebar-section-title">Overview</div>
        <div class="sidebar-stats" id="sidebar-stats"></div>
        <div id="tool-breakdown"></div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">Sessions</div>
        <div id="sessions-list"></div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">Tasks</div>
        <div id="tasks-list"></div>
      </div>
    </div>
  </div>

  <!-- Main Content -->
  <div class="main">
    <div class="main-header">
      <div>
        <div class="main-title" id="main-title">All Checkpoints</div>
        <div class="main-subtitle" id="main-subtitle">Showing all activity</div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;">
        <div class="header-live"><span class="live-dot"></span> Live</div>
        <div class="filter-bar">
          <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">All</button>
          <button class="filter-btn" data-filter="Write" onclick="setFilter('Write')">Write</button>
          <button class="filter-btn" data-filter="Edit" onclick="setFilter('Edit')">Edit</button>
          <button class="filter-btn" data-filter="Bash" onclick="setFilter('Bash')">Bash</button>
        </div>
      </div>
    </div>

    <div class="main-scroll" id="main-scroll"></div>
  </div>

</div>

<script>
let currentData = null;
let currentFilter = 'all';
let currentSessionFilter = null;
let currentTaskFilter = null;

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function relativeTime(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fileName(p) { return p ? p.split('/').pop() : ''; }

function formatDiff(files) {
  if (!files || files.length === 0) return '';
  let html = '';
  for (const f of files) {
    html += '<div class="diff-file-header">' + esc(fileName(f.file_path)) + '</div>';
    html += '<div class="diff-content">';
    if (!f.diff_content) {
      html += '<span class="diff-meta">no diff recorded</span>';
    } else {
      html += f.diff_content.split('\\n').map(function(line) {
        var e = esc(line);
        if (line.startsWith('+') && !line.startsWith('+++')) return '<span class="diff-add">' + e + '</span>';
        if (line.startsWith('-') && !line.startsWith('---')) return '<span class="diff-del">' + e + '</span>';
        if (line.startsWith('@@')) return '<span class="diff-hunk">' + e + '</span>';
        if (line.startsWith('Index:') || line.startsWith('===') || line.startsWith('---') || line.startsWith('+++'))
          return '<span class="diff-meta">' + e + '</span>';
        return e;
      }).join('\\n');
    }
    html += '</div>';
  }
  return html;
}

function toggleDiff(id) {
  document.getElementById('diff-' + id).classList.toggle('open');
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  render();
}

function filterBySession(sessionId) {
  currentSessionFilter = currentSessionFilter === sessionId ? null : sessionId;
  currentTaskFilter = null;
  render();
}

function filterByTask(taskId) {
  currentTaskFilter = currentTaskFilter === taskId ? null : taskId;
  currentSessionFilter = null;
  render();
}

function renderProjectInfo(data) {
  document.getElementById('project-info').innerHTML =
    '<div class="project-name">' + esc(data.project.name) + '</div>' +
    '<div class="project-path">' + esc(data.project.root) + '</div>';
}

function renderSidebarStats(data) {
  var s = data.stats;
  document.getElementById('sidebar-stats').innerHTML =
    '<div class="sidebar-stat"><div class="sidebar-stat-val">' + s.totalCheckpoints + '</div><div class="sidebar-stat-label">Checkpoints</div></div>' +
    '<div class="sidebar-stat"><div class="sidebar-stat-val">' + s.totalTasks + '</div><div class="sidebar-stat-label">Tasks</div></div>' +
    '<div class="sidebar-stat"><div class="sidebar-stat-val">' + s.totalSessions + '</div><div class="sidebar-stat-label">Sessions</div></div>' +
    '<div class="sidebar-stat"><div class="sidebar-stat-val">' + s.uniqueFiles + '</div><div class="sidebar-stat-label">Files</div></div>';

  // Tool breakdown bar
  var tc = s.toolCounts;
  var total = Object.values(tc).reduce(function(a,b){return a+b}, 0);
  if (total === 0) { document.getElementById('tool-breakdown').innerHTML = ''; return; }

  var colors = { Write: '#22c55e', Edit: '#f59e0b', Bash: '#ef4444', MultiEdit: '#a855f7' };
  var barHtml = '<div class="tool-bar">';
  var legendHtml = '<div class="tool-legend">';
  for (var tool in tc) {
    var pct = (tc[tool] / total * 100).toFixed(1);
    var col = colors[tool] || '#71717a';
    barHtml += '<div class="tool-bar-seg" style="width:' + pct + '%;background:' + col + '"></div>';
    legendHtml += '<div class="tool-legend-item"><div class="tool-legend-dot" style="background:' + col + '"></div>' + tool + ' ' + tc[tool] + '</div>';
  }
  barHtml += '</div>';
  legendHtml += '</div>';
  document.getElementById('tool-breakdown').innerHTML = barHtml + legendHtml;
}

function renderSessions(data) {
  var html = '';
  data.sessions.forEach(function(s) {
    var isActive = currentSessionFilter === s.id;
    var isLive = !s.ended_at;
    var meta = '';
    try { var m = JSON.parse(s.metadata); meta = m.cwd ? m.cwd.split('/').pop() : ''; } catch(e) {}
    html += '<div class="session-card' + (isActive ? ' active' : '') + '" onclick="filterBySession(\\''+s.id+'\\')">';
    html += '<div class="session-time"><span class="session-status ' + (isLive ? 'live' : 'ended') + '"></span>';
    html += (isLive ? 'Active session' : shortTime(s.started_at) + ' - ' + shortTime(s.ended_at)) + '</div>';
    html += '<div class="session-meta">' + s.checkpointCount + ' checkpoints &middot; ' + relativeTime(s.started_at) + '</div>';
    html += '</div>';
  });
  document.getElementById('sessions-list').innerHTML = html;
}

function renderTasks(data) {
  var html = '';
  data.tasks.forEach(function(t) {
    var isActive = currentTaskFilter === t.id;
    html += '<div class="task-item' + (isActive ? ' active-filter' : '') + '" onclick="filterByTask(\\''+t.id+'\\')">';
    html += '<div class="task-name"><span class="task-status-dot ' + t.status + '"></span>' + esc(t.name) + '</div>';
    html += '<span class="task-count">' + t.checkpointCount + '</span>';
    html += '</div>';
  });
  document.getElementById('tasks-list').innerHTML = html;
}

function renderTimeline(data) {
  var container = document.getElementById('main-scroll');
  var cps = data.checkpoints;

  // Apply filters
  if (currentFilter !== 'all') {
    cps = cps.filter(function(cp) { return cp.tool_name === currentFilter; });
  }
  if (currentSessionFilter) {
    cps = cps.filter(function(cp) { return cp.session_id === currentSessionFilter; });
  }
  if (currentTaskFilter) {
    cps = cps.filter(function(cp) { return cp.task_id === currentTaskFilter; });
  }

  // Update header
  var title = 'All Checkpoints';
  var subtitle = 'Showing all activity';
  if (currentSessionFilter) {
    title = 'Session';
    subtitle = cps.length + ' checkpoints';
  }
  if (currentTaskFilter) {
    var t = data.tasks.find(function(t) { return t.id === currentTaskFilter; });
    title = t ? t.name : 'Task';
    subtitle = cps.length + ' checkpoints';
  }
  if (currentFilter !== 'all') {
    subtitle += ' (filtered: ' + currentFilter + ')';
  }
  document.getElementById('main-title').textContent = title;
  document.getElementById('main-subtitle').textContent = subtitle;

  if (cps.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9716;</div><div class="empty-state-text">No checkpoints to show</div></div>';
    return;
  }

  // Group by task
  var taskMap = {};
  data.tasks.forEach(function(t) { taskMap[t.id] = t; });

  var html = '';
  var currentTaskId = '';

  for (var i = 0; i < cps.length; i++) {
    var cp = cps[i];

    // Task group header
    if (cp.task_id !== currentTaskId) {
      if (currentTaskId) html += '</div>'; // close prev group
      currentTaskId = cp.task_id;
      var task = taskMap[cp.task_id];
      var tName = task ? task.name : 'unnamed';
      var tStatus = task ? task.status : 'completed';
      var tCount = cps.filter(function(c) { return c.task_id === currentTaskId; }).length;

      html += '<div class="task-group">';
      html += '<div class="task-group-header">';
      html += '<div class="task-group-icon">T</div>';
      html += '<div class="task-group-title">' + esc(tName) + '</div>';
      html += '<span class="task-group-status ' + tStatus + '">' + tStatus + '</span>';
      html += '<div class="task-group-meta">' + tCount + ' checkpoints</div>';
      html += '</div>';
    }

    var tool = cp.tool_name || 'Write';
    var isLast = i === cps.length - 1 || cps[i+1].task_id !== cp.task_id;

    html += '<div class="cp-row">';
    html += '<div class="cp-line"><div class="cp-dot ' + tool + '"></div>';
    if (!isLast) html += '<div class="cp-connector"></div>';
    html += '</div>';

    html += '<div class="cp-card" onclick="toggleDiff(\\''+cp.id+'\\')">';
    html += '<div class="cp-card-header">';
    html += '<span class="cp-tool-badge ' + tool + '">' + tool + '</span>';
    html += '<span class="cp-id-badge">' + cp.id.slice(0,8) + '</span>';
    html += '<span class="cp-time-badge">' + relativeTime(cp.created_at) + '</span>';
    html += '</div>';

    if (cp.files && cp.files.length > 0) {
      html += '<div class="cp-files-row">';
      cp.files.forEach(function(f) {
        html += '<span class="cp-file-tag">' + esc(fileName(f.file_path)) + '</span>';
      });
      html += '</div>';
    }

    if (cp.reasoning) {
      html += '<div class="cp-reasoning-box">';
      html += '<div class="cp-reasoning-label">User prompt</div>';
      html += esc(cp.reasoning);
      html += '</div>';
    }

    html += '<div class="diff-panel" id="diff-' + cp.id + '">' + formatDiff(cp.files) + '</div>';
    html += '</div></div>';
  }

  if (currentTaskId) html += '</div>'; // close last group
  container.innerHTML = html;
}

function render() {
  if (!currentData) return;
  renderProjectInfo(currentData);
  renderSidebarStats(currentData);
  renderSessions(currentData);
  renderTasks(currentData);
  renderTimeline(currentData);
}

async function loadData() {
  var res = await fetch('/api/data');
  currentData = await res.json();
  render();
}

loadData();
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
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
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
