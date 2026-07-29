import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

export function safeName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_') || 'pdf';
}

interface PdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath?: string;
}

export async function validateJobPaths(jobs: PdfJob[], stagingDirectoryName: string): Promise<void> {
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
