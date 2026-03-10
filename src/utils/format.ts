import pc from 'picocolors';

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatCheckpointLine(
  seq: number,
  id: string,
  toolName: string,
  filePaths: string[],
  createdAt: string,
  taskName?: string
): string {
  const time = formatRelativeTime(createdAt);
  const shortId = id.slice(0, 8);
  const files = filePaths.length > 0 ? filePaths.map(f => f.split('/').pop()).join(', ') : 'no files';

  let line = `${pc.yellow(shortId)} ${pc.cyan(toolName.padEnd(8))} ${files}`;
  if (taskName) {
    line += ` ${pc.dim(`[${taskName}]`)}`;
  }
  line += ` ${pc.dim(time)}`;

  return line;
}

export function formatDiffOutput(diffContent: string): string {
  return diffContent
    .split('\n')
    .map(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) return pc.green(line);
      if (line.startsWith('-') && !line.startsWith('---')) return pc.red(line);
      if (line.startsWith('@@')) return pc.cyan(line);
      return line;
    })
    .join('\n');
}

export function header(text: string): string {
  return pc.bold(pc.white(text));
}

export function success(text: string): string {
  return pc.green(text);
}

export function error(text: string): string {
  return pc.red(text);
}

export function dim(text: string): string {
  return pc.dim(text);
}
