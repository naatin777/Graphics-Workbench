import path from 'node:path';

import {
  assertExistingPathInWorkspace,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security/workspace_path.js';
import { isSafePathSegment } from '@graphics-workbench/core/operations/lifecycle/run_id.js';

export function sanitizePdfPathSegment(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
  return isSafePathSegment(sanitized) ? sanitized : 'pdf';
}

/** A single source whose source/output/staging paths are checked before a PDF operation runs. */
interface PdfPathValidationInput {
  sourcePath: string;
  workspacePath: string;
  outputPath?: string;
}

export async function validatePdfPathInputs(
  inputs: PdfPathValidationInput[],
  stagingDirectoryName: string,
): Promise<void> {
  await Promise.all(
    inputs.flatMap((input) => [
      assertExistingPathInWorkspace(input.sourcePath, input.workspacePath),
      ...(input.outputPath === undefined ? [] : [assertWritablePathInWorkspace(input.outputPath, input.workspacePath)]),
      assertWritablePathInWorkspace(
        path.join(input.workspacePath, '.graphics-workbench', stagingDirectoryName),
        input.workspacePath,
      ),
    ]),
  );
}
