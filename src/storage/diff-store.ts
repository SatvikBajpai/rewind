import fs from 'fs';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';

export function ensureDiffsDir(rewindDir: string): string {
  const diffsDir = path.join(rewindDir, 'diffs');
  if (!fs.existsSync(diffsDir)) {
    fs.mkdirSync(diffsDir, { recursive: true });
  }
  return diffsDir;
}

export function saveSnapshot(rewindDir: string, checkpointId: string, fileHash: string, content: Buffer): string {
  const dir = path.join(ensureDiffsDir(rewindDir), checkpointId);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${fileHash}.snapshot.gz`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, gzipSync(content));

  return filepath;
}

export function loadSnapshot(snapshotPath: string): Buffer {
  const compressed = fs.readFileSync(snapshotPath);
  return gunzipSync(compressed);
}

export function saveDiff(rewindDir: string, checkpointId: string, fileHash: string, diffContent: string): string {
  const dir = path.join(ensureDiffsDir(rewindDir), checkpointId);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${fileHash}.patch`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, diffContent, 'utf-8');

  return filepath;
}

export function loadDiff(diffPath: string): string {
  return fs.readFileSync(diffPath, 'utf-8');
}

export function removeCheckpointDiffs(rewindDir: string, checkpointId: string): void {
  const dir = path.join(ensureDiffsDir(rewindDir), checkpointId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}
