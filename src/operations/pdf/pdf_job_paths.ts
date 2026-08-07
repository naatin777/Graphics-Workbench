import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { isSafePathSegment } from '../lifecycle/run_id.js';

export function sanitizePdfPathSegment(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
  return isSafePathSegment(sanitized) ? sanitized : 'pdf';
}

interface PdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath?: string;
}

export async function validatePdfJobPaths(jobs: PdfJob[], stagingDirectoryName: string): Promise<void> {
  await Promise.all(
    jobs.flatMap((job) => [
      assertExistingPathInWorkspace(job.sourcePath, job.workspacePath),
      ...(job.outputPath === undefined ? [] : [assertWritablePathInWorkspace(job.outputPath, job.workspacePath)]),
      assertWritablePathInWorkspace(
        path.join(job.workspacePath, '.graphics-workbench', stagingDirectoryName),
        job.workspacePath,
      ),
    ]),
  );
}
