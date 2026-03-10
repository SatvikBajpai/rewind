import { getRewindDir } from '../../utils/config';
import { initializeDb } from '../../storage/database';
import { getCheckpoint, getLatestCheckpoint } from '../../core/checkpoint';
import { formatDiffOutput, error, dim, header } from '../../utils/format';

export function diffCommand(checkpointId?: string): void {
  const rewindDir = getRewindDir();
  initializeDb(rewindDir);

  let cp;
  if (checkpointId) {
    cp = getCheckpoint(rewindDir, checkpointId);
    if (!cp) {
      console.log(error(`Checkpoint not found: ${checkpointId}`));
      process.exit(1);
    }
  } else {
    const latest = getLatestCheckpoint(rewindDir);
    if (!latest) {
      console.log(dim('No checkpoints yet.'));
      return;
    }
    cp = getCheckpoint(rewindDir, latest.id);
  }

  if (!cp) return;

  console.log(header(`Checkpoint ${cp.id.slice(0, 8)}`));
  console.log(dim(`Tool: ${cp.tool_name} | ${cp.created_at}`));
  if (cp.reasoning) {
    console.log(dim(`Reasoning: ${cp.reasoning}`));
  }
  console.log();

  for (const file of cp.files) {
    if (file.diff_content) {
      console.log(formatDiffOutput(file.diff_content));
    } else {
      console.log(dim(`  ${file.file_path}: no diff recorded`));
    }
  }
}
