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

  const taskCounts: Record<string, number> = {};
  for (const cp of checkpoints) { taskCounts[cp.task_id] = (taskCounts[cp.task_id] || 0) + 1; }

  const sessionCounts: Record<string, number> = {};
  for (const cp of checkpoints) { sessionCounts[cp.session_id] = (sessionCounts[cp.session_id] || 0) + 1; }

  const toolCounts: Record<string, number> = {};
  for (const cp of checkpoints) { const t = cp.tool_name || 'unknown'; toolCounts[t] = (toolCounts[t] || 0) + 1; }

  const uniqueFiles = new Set<string>();
  for (const cp of checkpointsWithFiles) { for (const f of cp.files) { uniqueFiles.add(f.file_path); } }

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
<html lang="en" data-color-mode="dark" data-dark-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>rewind</title>
<style>
  :root {
    --color-canvas-default: #0d1117;
    --color-canvas-subtle: #161b22;
    --color-canvas-inset: #010409;
    --color-border-default: #30363d;
    --color-border-muted: #21262d;
    --color-fg-default: #e6edf3;
    --color-fg-muted: #8b949e;
    --color-fg-subtle: #6e7681;
    --color-accent-fg: #58a6ff;
    --color-success-fg: #3fb950;
    --color-danger-fg: #f85149;
    --color-attention-fg: #d29922;
    --color-done-fg: #a371f7;
    --color-neutral-muted: rgba(110,118,129,0.4);
    --color-accent-subtle: rgba(56,139,253,0.15);
    --color-success-subtle: rgba(46,160,67,0.15);
    --color-danger-subtle: rgba(248,81,73,0.1);
    --color-attention-subtle: rgba(187,128,9,0.15);
    --color-done-subtle: rgba(163,113,247,0.15);
    --border-radius: 6px;
    --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-sans);
    background: var(--color-canvas-default);
    color: var(--color-fg-default);
    font-size: 14px;
    line-height: 1.5;
  }

  /* ── Top Nav ── */
  .top-nav {
    background: var(--color-canvas-subtle);
    border-bottom: 1px solid var(--color-border-default);
    padding: 0 24px;
    height: 48px;
    display: flex;
    align-items: center;
    gap: 16px;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .nav-logo {
    font-weight: 700;
    font-size: 16px;
    color: var(--color-fg-default);
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
  }

  .nav-logo svg { fill: var(--color-fg-default); }

  .nav-sep { color: var(--color-fg-subtle); font-size: 18px; font-weight: 300; }

  .nav-project {
    font-weight: 600;
    font-size: 14px;
    color: var(--color-accent-fg);
  }

  .nav-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .nav-live {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-success-fg);
    background: var(--color-success-subtle);
    padding: 3px 10px;
    border-radius: 20px;
  }

  .live-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--color-success-fg);
    animation: pulse 2s infinite;
  }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

  /* ── Page Container ── */
  .page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px;
  }

  /* ── Stats Row ── */
  .stats-row {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
  }

  .stat-box {
    flex: 1;
    background: var(--color-canvas-subtle);
    border: 1px solid var(--color-border-default);
    border-radius: var(--border-radius);
    padding: 16px 20px;
  }

  .stat-label {
    font-size: 12px;
    color: var(--color-fg-muted);
    margin-bottom: 4px;
  }

  .stat-value {
    font-size: 24px;
    font-weight: 600;
    color: var(--color-fg-default);
  }

  /* ── Tabs / Filters ── */
  .tab-nav {
    display: flex;
    border-bottom: 1px solid var(--color-border-default);
    margin-bottom: 16px;
    gap: 0;
  }

  .tab-btn {
    padding: 8px 16px;
    font-size: 14px;
    font-family: inherit;
    color: var(--color-fg-muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: color 0.15s;
  }

  .tab-btn:hover { color: var(--color-fg-default); }

  .tab-btn.active {
    color: var(--color-fg-default);
    font-weight: 600;
    border-bottom-color: #f78166;
  }

  .tab-count {
    font-size: 12px;
    background: var(--color-neutral-muted);
    padding: 0 8px;
    border-radius: 10px;
    font-weight: 600;
  }

  /* ── Layout: sidebar + content ── */
  .content-layout {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 24px;
  }

  /* ── Sidebar (right side, like GitHub) ── */
  .right-sidebar section {
    margin-bottom: 20px;
  }

  .sidebar-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--color-border-muted);
    margin-bottom: 10px;
  }

  /* Session items */
  .session-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--border-radius);
    cursor: pointer;
    transition: background 0.1s;
    margin-bottom: 2px;
  }

  .session-item:hover { background: var(--color-canvas-subtle); }
  .session-item.selected { background: var(--color-accent-subtle); }

  .session-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-top: 6px;
    flex-shrink: 0;
  }

  .session-dot.live { background: var(--color-success-fg); }
  .session-dot.ended { background: var(--color-fg-subtle); }

  .session-label { font-size: 13px; color: var(--color-fg-default); }
  .session-detail { font-size: 12px; color: var(--color-fg-subtle); }

  /* Task items */
  .task-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-radius: var(--border-radius);
    cursor: pointer;
    transition: background 0.1s;
    margin-bottom: 2px;
  }

  .task-item:hover { background: var(--color-canvas-subtle); }
  .task-item.selected { background: var(--color-accent-subtle); }

  .task-label {
    font-size: 13px;
    color: var(--color-fg-default);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-indicator {
    width: 6px; height: 6px;
    border-radius: 50%;
  }

  .status-indicator.active { background: var(--color-success-fg); }
  .status-indicator.completed { background: var(--color-fg-subtle); }

  .counter-badge {
    font-size: 12px;
    color: var(--color-fg-muted);
    background: var(--color-neutral-muted);
    padding: 0 8px;
    border-radius: 10px;
  }

  /* Tool breakdown */
  .tool-breakdown {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tool-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .tool-color {
    width: 10px; height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .tool-name { color: var(--color-fg-muted); flex: 1; }

  .tool-pct {
    color: var(--color-fg-subtle);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .tool-bar-full {
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    background: var(--color-neutral-muted);
    margin-bottom: 10px;
  }

  .tool-bar-seg { height: 100%; }

  /* ── Timeline (main column) ── */
  .timeline-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .timeline-title {
    font-size: 16px;
    font-weight: 600;
  }

  .timeline-subtitle {
    font-size: 12px;
    color: var(--color-fg-subtle);
  }

  /* Commit-style list (like GitHub commits page) */
  .commit-group {
    margin-bottom: 24px;
  }

  .commit-group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--color-canvas-subtle);
    border: 1px solid var(--color-border-default);
    border-radius: var(--border-radius) var(--border-radius) 0 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-fg-muted);
  }

  .commit-group-header svg { fill: var(--color-fg-subtle); }

  .commit-group-status {
    font-size: 11px;
    font-weight: 500;
    padding: 1px 8px;
    border-radius: 10px;
    margin-left: 4px;
  }

  .commit-group-status.active {
    background: var(--color-success-subtle);
    color: var(--color-success-fg);
  }

  .commit-group-status.completed {
    background: var(--color-neutral-muted);
    color: var(--color-fg-subtle);
  }

  .commit-group-count {
    margin-left: auto;
    font-weight: 400;
    color: var(--color-fg-subtle);
  }

  .commit-list {
    border: 1px solid var(--color-border-default);
    border-top: none;
    border-radius: 0 0 var(--border-radius) var(--border-radius);
    overflow: hidden;
  }

  .commit-row {
    display: flex;
    align-items: flex-start;
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-border-muted);
    cursor: pointer;
    transition: background 0.1s;
    gap: 12px;
  }

  .commit-row:last-child { border-bottom: none; }
  .commit-row:hover { background: var(--color-canvas-subtle); }

  .commit-icon {
    width: 32px; height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    margin-top: 2px;
  }

  .commit-icon.Write { background: var(--color-success-subtle); color: var(--color-success-fg); }
  .commit-icon.Edit { background: var(--color-attention-subtle); color: var(--color-attention-fg); }
  .commit-icon.Bash { background: var(--color-danger-subtle); color: var(--color-danger-fg); }
  .commit-icon.MultiEdit { background: var(--color-done-subtle); color: var(--color-done-fg); }
  .commit-icon.manual { background: var(--color-accent-subtle); color: var(--color-accent-fg); }

  .commit-body { flex: 1; min-width: 0; }

  .commit-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .commit-msg {
    font-size: 14px;
    color: var(--color-fg-default);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-files {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .file-badge {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-fg-muted);
    background: var(--color-neutral-muted);
    padding: 1px 8px;
    border-radius: 4px;
  }

  .commit-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
    font-size: 12px;
    color: var(--color-fg-subtle);
  }

  .commit-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }

  .commit-sha {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-accent-fg);
    background: var(--color-accent-subtle);
    padding: 2px 8px;
    border-radius: var(--border-radius);
  }

  .commit-time {
    font-size: 12px;
    color: var(--color-fg-subtle);
  }

  /* Reasoning inline */
  .commit-reasoning {
    margin-top: 8px;
    padding: 8px 12px;
    background: var(--color-canvas-inset);
    border: 1px solid var(--color-border-muted);
    border-left: 3px solid var(--color-accent-fg);
    border-radius: var(--border-radius);
    font-size: 12px;
    color: var(--color-fg-muted);
    line-height: 1.5;
  }

  .reasoning-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--color-accent-fg);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  /* Diff view (GitHub-style) */
  .diff-panel {
    display: none;
    margin-top: 10px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--border-radius);
    overflow: hidden;
  }

  .diff-panel.open { display: block; }

  .diff-file-header {
    padding: 8px 16px;
    background: var(--color-canvas-subtle);
    border-bottom: 1px solid var(--color-border-default);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-fg-muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .diff-file-header svg { fill: var(--color-fg-subtle); }

  .diff-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
  }

  .diff-table td {
    padding: 0 16px;
    white-space: pre;
    vertical-align: top;
  }

  .diff-line-add { background: rgba(46,160,67,0.15); color: var(--color-success-fg); }
  .diff-line-del { background: rgba(248,81,73,0.1); color: var(--color-danger-fg); }
  .diff-line-hunk { color: var(--color-accent-fg); background: var(--color-accent-subtle); }
  .diff-line-meta { color: var(--color-fg-subtle); }

  /* Empty */
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--color-fg-subtle);
  }

  .empty-state-title { font-size: 20px; font-weight: 600; color: var(--color-fg-muted); margin-bottom: 4px; }

  /* Responsive */
  @media (max-width: 900px) {
    .content-layout { grid-template-columns: 1fr; }
    .right-sidebar { order: -1; }
    .stats-row { flex-wrap: wrap; }
    .stat-box { min-width: 120px; }
  }
</style>
</head>
<body>

<!-- Top Nav -->
<nav class="top-nav">
  <a class="nav-logo" href="/">
    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
    rewind
  </a>
  <span class="nav-sep">/</span>
  <span class="nav-project" id="nav-project">project</span>

  <div class="nav-right">
    <div class="nav-live" id="nav-live"><span class="live-dot"></span> Watching</div>
  </div>
</nav>

<div class="page">

  <!-- Stats -->
  <div class="stats-row" id="stats-row"></div>

  <!-- Tabs -->
  <div class="tab-nav" id="tab-nav">
    <button class="tab-btn active" data-filter="all" onclick="setFilter('all')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/></svg>
      All <span class="tab-count" id="count-all">0</span>
    </button>
    <button class="tab-btn" data-filter="Write" onclick="setFilter('Write')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z"/></svg>
      Write <span class="tab-count" id="count-Write">0</span>
    </button>
    <button class="tab-btn" data-filter="Edit" onclick="setFilter('Edit')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z"/></svg>
      Edit <span class="tab-count" id="count-Edit">0</span>
    </button>
    <button class="tab-btn" data-filter="Bash" onclick="setFilter('Bash')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.749.749 0 0 1-.22.53l-2.25 2.25a.749.749 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.749.749 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z"/></svg>
      Bash <span class="tab-count" id="count-Bash">0</span>
    </button>
  </div>

  <!-- Main layout -->
  <div class="content-layout">

    <!-- Timeline (main) -->
    <div class="timeline-col" id="timeline-col"></div>

    <!-- Right sidebar -->
    <div class="right-sidebar">
      <section>
        <div class="sidebar-title">Sessions</div>
        <div id="sessions-list"></div>
      </section>

      <section>
        <div class="sidebar-title">Tasks</div>
        <div id="tasks-list"></div>
      </section>

      <section>
        <div class="sidebar-title">Tool Breakdown</div>
        <div id="tool-breakdown"></div>
      </section>

      <section>
        <div class="sidebar-title">Files Touched</div>
        <div id="files-list"></div>
      </section>
    </div>

  </div>
</div>

<script>
var currentData = null;
var currentFilter = 'all';
var currentSessionFilter = null;
var currentTaskFilter = null;

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function relativeTime(iso) {
  if (!iso) return '';
  var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + ' seconds ago';
  var m = Math.floor(s / 60);
  if (m < 60) return m + ' minute' + (m>1?'s':'') + ' ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + ' hour' + (h>1?'s':'') + ' ago';
  return Math.floor(h / 24) + ' day' + (Math.floor(h/24)>1?'s':'') + ' ago';
}

function shortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function fileName(p) { return p ? p.split('/').pop() : ''; }

function toolLabel(tool, files) {
  if (!files || files.length === 0) return tool;
  var f = fileName(files[0].file_path);
  switch(tool) {
    case 'Write': return files[0].file_existed ? 'Overwrote ' + f : 'Created ' + f;
    case 'Edit': return 'Edited ' + f;
    case 'Bash': return 'Ran command';
    case 'MultiEdit': return 'Multi-edited ' + f;
    default: return tool + ' ' + f;
  }
}

function formatDiffHTML(files) {
  if (!files || files.length === 0) return '';
  var html = '';
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    html += '<div class="diff-file-header">';
    html += '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Z" fill="currentColor"/></svg>';
    html += esc(f.file_path);
    html += '</div>';
    html += '<table class="diff-table"><tbody>';
    if (!f.diff_content) {
      html += '<tr><td class="diff-line-meta">no diff recorded</td></tr>';
    } else {
      var lines = f.diff_content.split('\\n');
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        var e = esc(line);
        var cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-line-add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-line-del';
        else if (line.startsWith('@@')) cls = 'diff-line-hunk';
        else if (line.startsWith('Index:') || line.startsWith('===') || line.startsWith('---') || line.startsWith('+++')) cls = 'diff-line-meta';
        html += '<tr><td class="' + cls + '">' + e + '</td></tr>';
      }
    }
    html += '</tbody></table>';
  }
  return html;
}

function toggleDiff(id) {
  document.getElementById('diff-' + id).classList.toggle('open');
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  renderTimeline();
}

function selectSession(id) {
  currentSessionFilter = currentSessionFilter === id ? null : id;
  currentTaskFilter = null;
  render();
}

function selectTask(id) {
  currentTaskFilter = currentTaskFilter === id ? null : id;
  currentSessionFilter = null;
  render();
}

function renderStats(data) {
  var s = data.stats;
  document.getElementById('stats-row').innerHTML =
    '<div class="stat-box"><div class="stat-label">Checkpoints</div><div class="stat-value">' + s.totalCheckpoints + '</div></div>' +
    '<div class="stat-box"><div class="stat-label">Tasks</div><div class="stat-value">' + s.totalTasks + '</div></div>' +
    '<div class="stat-box"><div class="stat-label">Sessions</div><div class="stat-value">' + s.totalSessions + '</div></div>' +
    '<div class="stat-box"><div class="stat-label">Files Touched</div><div class="stat-value">' + s.uniqueFiles + '</div></div>';
}

function renderSessions(data) {
  var html = '';
  data.sessions.forEach(function(s) {
    var live = !s.ended_at;
    html += '<div class="session-item' + (currentSessionFilter === s.id ? ' selected' : '') + '" onclick="selectSession(\\''+s.id+'\\')">';
    html += '<div class="session-dot ' + (live ? 'live' : 'ended') + '"></div>';
    html += '<div>';
    html += '<div class="session-label">' + (live ? 'Active session' : shortDate(s.started_at)) + '</div>';
    html += '<div class="session-detail">' + s.checkpointCount + ' checkpoints &middot; ' + relativeTime(s.started_at) + '</div>';
    html += '</div></div>';
  });
  document.getElementById('sessions-list').innerHTML = html;
}

function renderTasks(data) {
  var html = '';
  data.tasks.forEach(function(t) {
    html += '<div class="task-item' + (currentTaskFilter === t.id ? ' selected' : '') + '" onclick="selectTask(\\''+t.id+'\\')">';
    html += '<div class="task-label"><div class="status-indicator ' + t.status + '"></div>' + esc(t.name) + '</div>';
    html += '<span class="counter-badge">' + t.checkpointCount + '</span>';
    html += '</div>';
  });
  document.getElementById('tasks-list').innerHTML = html;
}

function renderToolBreakdown(data) {
  var tc = data.stats.toolCounts;
  var total = Object.values(tc).reduce(function(a,b){return a+b}, 0);
  if (total === 0) { document.getElementById('tool-breakdown').innerHTML = ''; return; }

  var colors = { Write:'#3fb950', Edit:'#d29922', Bash:'#f85149', MultiEdit:'#a371f7' };
  var html = '<div class="tool-bar-full">';
  for (var t in tc) {
    html += '<div class="tool-bar-seg" style="width:'+((tc[t]/total)*100).toFixed(1)+'%;background:'+(colors[t]||'#6e7681')+'"></div>';
  }
  html += '</div><div class="tool-breakdown">';
  for (var t in tc) {
    var pct = ((tc[t]/total)*100).toFixed(0);
    html += '<div class="tool-row">';
    html += '<div class="tool-color" style="background:'+(colors[t]||'#6e7681')+'"></div>';
    html += '<span class="tool-name">' + t + '</span>';
    html += '<span class="tool-pct">' + pct + '%</span>';
    html += '</div>';
  }
  html += '</div>';
  document.getElementById('tool-breakdown').innerHTML = html;
}

function renderFilesList(data) {
  var fileCounts = {};
  data.checkpoints.forEach(function(cp) {
    cp.files.forEach(function(f) {
      var n = fileName(f.file_path);
      fileCounts[n] = (fileCounts[n] || 0) + 1;
    });
  });

  var sorted = Object.entries(fileCounts).sort(function(a,b){ return b[1]-a[1]; }).slice(0,10);
  var html = '<div class="tool-breakdown">';
  sorted.forEach(function(e) {
    html += '<div class="tool-row" style="font-family:var(--font-mono)">';
    html += '<span class="tool-name">' + esc(e[0]) + '</span>';
    html += '<span class="tool-pct">' + e[1] + 'x</span>';
    html += '</div>';
  });
  html += '</div>';
  document.getElementById('files-list').innerHTML = html;
}

function renderTabCounts(data) {
  var tc = data.stats.toolCounts;
  document.getElementById('count-all').textContent = data.stats.totalCheckpoints;
  document.getElementById('count-Write').textContent = tc.Write || 0;
  document.getElementById('count-Edit').textContent = tc.Edit || 0;
  document.getElementById('count-Bash').textContent = tc.Bash || 0;
}

function renderTimeline() {
  var data = currentData;
  if (!data) return;

  var cps = data.checkpoints.slice();

  if (currentFilter !== 'all') cps = cps.filter(function(cp) { return cp.tool_name === currentFilter; });
  if (currentSessionFilter) cps = cps.filter(function(cp) { return cp.session_id === currentSessionFilter; });
  if (currentTaskFilter) cps = cps.filter(function(cp) { return cp.task_id === currentTaskFilter; });

  var container = document.getElementById('timeline-col');

  if (cps.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No checkpoints</div><div>Nothing to show with current filters.</div></div>';
    return;
  }

  var taskMap = {};
  data.tasks.forEach(function(t) { taskMap[t.id] = t; });

  var html = '';
  var currentTaskId = '';

  for (var i = 0; i < cps.length; i++) {
    var cp = cps[i];

    if (cp.task_id !== currentTaskId) {
      if (currentTaskId) html += '</div></div>';
      currentTaskId = cp.task_id;
      var task = taskMap[cp.task_id];
      var tName = task ? task.name : 'unnamed';
      var tStatus = task ? task.status : 'completed';
      var tCount = cps.filter(function(c){return c.task_id === currentTaskId}).length;

      html += '<div class="commit-group">';
      html += '<div class="commit-group-header">';
      html += '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Z" fill="currentColor"/></svg>';
      html += esc(tName);
      html += '<span class="commit-group-status ' + tStatus + '">' + tStatus + '</span>';
      html += '<span class="commit-group-count">' + tCount + ' checkpoint' + (tCount!==1?'s':'') + '</span>';
      html += '</div>';
      html += '<div class="commit-list">';
    }

    var tool = cp.tool_name || 'Write';
    var label = toolLabel(tool, cp.files);

    html += '<div class="commit-row" onclick="toggleDiff(\\''+cp.id+'\\')">';
    html += '<div class="commit-icon ' + tool + '">' + tool[0] + '</div>';
    html += '<div class="commit-body">';
    html += '<div class="commit-title-row"><div class="commit-msg">' + esc(label) + '</div></div>';

    if (cp.files && cp.files.length > 0) {
      html += '<div class="commit-files">';
      cp.files.forEach(function(f) {
        html += '<span class="file-badge">' + esc(fileName(f.file_path)) + '</span>';
      });
      html += '</div>';
    }

    if (cp.reasoning) {
      html += '<div class="commit-reasoning">';
      html += '<div class="reasoning-label">User prompt</div>';
      html += esc(cp.reasoning);
      html += '</div>';
    }

    html += '<div class="diff-panel" id="diff-' + cp.id + '">' + formatDiffHTML(cp.files) + '</div>';
    html += '</div>';

    html += '<div class="commit-right">';
    html += '<span class="commit-sha">' + cp.id.slice(0,7) + '</span>';
    html += '<span class="commit-time">' + relativeTime(cp.created_at) + '</span>';
    html += '</div>';
    html += '</div>';
  }

  if (currentTaskId) html += '</div></div>';
  container.innerHTML = html;
}

function render() {
  if (!currentData) return;
  document.getElementById('nav-project').textContent = currentData.project.name;

  var hasActive = currentData.sessions.some(function(s){ return !s.ended_at; });
  document.getElementById('nav-live').style.display = hasActive ? 'flex' : 'none';

  renderStats(currentData);
  renderTabCounts(currentData);
  renderSessions(currentData);
  renderTasks(currentData);
  renderToolBreakdown(currentData);
  renderFilesList(currentData);
  renderTimeline();
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
