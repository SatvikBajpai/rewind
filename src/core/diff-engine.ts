import { createTwoFilesPatch } from 'diff';

export function computeDiff(filePath: string, oldContent: string, newContent: string): string {
  return createTwoFilesPatch(filePath, filePath, oldContent, newContent, 'before', 'after');
}

export function createNewFileDiff(filePath: string, content: string): string {
  return createTwoFilesPatch(filePath, filePath, '', content, '', 'new file');
}

export function createDeleteFileDiff(filePath: string, content: string): string {
  return createTwoFilesPatch(filePath, filePath, content, '', 'deleted file', '');
}
