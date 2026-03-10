import { createHash } from 'crypto';
import fs from 'fs';

export function hashContent(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function hashFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return hashContent(content);
  } catch {
    return null;
  }
}
