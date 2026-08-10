import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { openPdfDocument, savePdfDocument } from './mupdf.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createSecurePdfStagingRoot } from '../lifecycle/secure_staging.js';

export interface EncryptPdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface EncryptPdfOptions {
  inputs: EncryptPdfInput[];
  password: string;
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function encryptPdfFiles(options: EncryptPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validatePassword(options.password);
  validateConversions(options.inputs);
  await validatePdfPathInputs(options.inputs, 'encrypt-pdf');

  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.inputs);
  }

  runtime?.signal?.throwIfAborted();

  const stagingRootPath = await createSecurePdfStagingRoot('encrypt-pdf');

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'encrypt-pdf',
    stagingOperationName: 'encrypt-pdf',
    runId: options.runId,
    artifactRoots: [{ rootPath: stagingRootPath, workspacePath: stagingRootPath }],
    ...(runtime !== undefined && { runtime }),
    stage: async (input, index, _runId, batchRuntime) =>
      encryptPdf({
        input,
        index,
        password: options.password,
        stagingRootPath,
        signal: batchRuntime.signal,
      }),
  });
}

async function encryptPdf(params: {
  input: EncryptPdfInput;
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
  // ponytail: the password is embedded in the save options string; passwords
  // containing `,` or `=` break mupdf's option parser. qpdf previously used a input
  // JSON to keep secrets out of argv; mupdf runs in-process, so that is not a
  // concern here, only the comma/equals limitation remains.
  try {
    const saveOptions = `encrypt=aes-256,user-password=${password},owner-password=${password}`;
    const encryptedBytes = savePdfDocument(document, saveOptions);
    signal.throwIfAborted();
    await writeFile(stagedOutputPath, encryptedBytes);
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

function validatePassword(password: string): void {
  if (password.includes(',') || password.includes('=')) {
    throw new Error("PDF passwords cannot contain ',' or '='.");
  }
}

function validateConversions(inputs: EncryptPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be encrypted: ${input.sourcePath}`);
    }
  }
}

async function assertOutputsDoNotExist(inputs: EncryptPdfInput[]): Promise<void> {
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

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
