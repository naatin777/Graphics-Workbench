import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertExistingPathInWorkspace,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security/workspace_path.js';
import { openPdfDocument, savePdfDocument } from '@graphics-workbench/core/operations/pdf/mupdf.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type {
  CommittedConversionOutput,
  PreparedConversionOutput,
} from '@graphics-workbench/core/operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '@graphics-workbench/core/operations/lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '@graphics-workbench/core/operations/lifecycle/run_staged_conversion_batch.js';
import { createSecurePdfStagingRoot } from '../lifecycle/secure_staging.js';

export interface DecryptPdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface DecryptPdfOptions {
  inputs: DecryptPdfInput[];
  password: string;
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function decryptPdfFiles(options: DecryptPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateConversions(options.inputs);
  await validatePdfPathInputs(options.inputs, 'decrypt-pdf');

  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.inputs);
  }

  runtime?.signal?.throwIfAborted();

  const stagingRootPath = await createSecurePdfStagingRoot('decrypt-pdf');

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'decrypt-pdf',
    stagingOperationName: 'decrypt-pdf',
    runId: options.runId,
    artifactRoots: [{ rootPath: stagingRootPath, workspacePath: stagingRootPath }],
    ...(runtime !== undefined && { runtime }),
    stage: async (input, index, _runId, batchRuntime) =>
      decryptPdf({
        input,
        index,
        password: options.password,
        stagingRootPath,
        signal: batchRuntime.signal,
      }),
  });
}

async function decryptPdf(params: {
  input: DecryptPdfInput;
  index: number;
  password: string;
  stagingRootPath: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { input, password, signal } = params;
  signal.throwIfAborted();

  const itemName = `${params.index + 1}-${sanitizePdfPathSegment(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`;
  const workDirectory = path.join(params.stagingRootPath, itemName);
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(input.sourcePath, input.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, params.stagingRootPath);
  signal.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  signal.throwIfAborted();

  const bytes = await readFile(input.sourcePath);
  signal.throwIfAborted();
  const document = await openPdfDocument(bytes);
  try {
    if (document.needsPassword() && document.authenticatePassword(password) === 0) {
      throw new Error(`Invalid password for PDF file: ${input.sourcePath}`);
    }
    const decryptedBytes = savePdfDocument(document, 'encrypt=none');
    signal.throwIfAborted();
    await writeFile(stagedOutputPath, decryptedBytes);
  } finally {
    document.destroy();
  }

  signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath: params.stagingRootPath,
    stagingWorkspacePath: params.stagingRootPath,
  };
}

function validateConversions(inputs: DecryptPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be decrypted: ${input.sourcePath}`);
    }
  }
}

async function assertOutputsDoNotExist(inputs: DecryptPdfInput[]): Promise<void> {
  const normalizedOutputs = new Set<string>();

  for (const input of inputs) {
    const normalizedOutput = path.resolve(input.outputPath);

    if (normalizedOutputs.has(normalizedOutput)) {
      throw new Error(`Multiple inputs resolve to the same output: ${input.outputPath}`);
    }
    normalizedOutputs.add(normalizedOutput);

    try {
      await access(input.outputPath);
      throw new Error(`Output file already exists: ${input.outputPath}`);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        continue;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

// oxlint-disable-next-line typescript/no-restricted-types -- 型ガード: catch由来の値を識別する。
function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
