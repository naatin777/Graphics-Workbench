import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';
import { openPdfDocument, savePdfDocument } from './mupdf.js';

export interface CompressPdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface CompressPdfOptions {
  inputs: CompressPdfInput[];
  runtime: ConversionExecutionContext;
  runId?: string;
}

export async function compressPdfFiles(options: CompressPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime.signal?.throwIfAborted();
  validateConversions(options.inputs);
  await validatePdfPathInputs(options.inputs, 'compress-pdf');

  runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'compress-pdf',
    runId: options.runId,
    runtime,
    stage: async (input, index, currentRunId, batchRuntime) =>
      compressPdf({
        input,
        index,
        runId: currentRunId,
        signal: batchRuntime.signal,
      }),
  });
}

async function compressPdf(params: {
  input: CompressPdfInput;
  index: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { input, runId, signal } = params;
  signal.throwIfAborted();

  const itemName = `${params.index + 1}-${sanitizePdfPathSegment(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'compress-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const copiedSourcePath = path.join(workDirectory, path.basename(input.sourcePath));
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(input.sourcePath, input.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, input.workspacePath);
  signal.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();
  await copyFileWithAbort(input.sourcePath, copiedSourcePath, undefined, signal);
  await assertExistingPathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();

  const document = await openPdfDocument(await readFile(copiedSourcePath));
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = savePdfDocument(document, 'garbage=4,compress=yes,compression-effort=10');
  } finally {
    document.destroy();
  }
  signal.throwIfAborted();
  await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
  signal.throwIfAborted();
  await writeFile(stagedOutputPath, pdfBytes);
  signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}

function validateConversions(inputs: CompressPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be compressed: ${input.sourcePath}`);
    }
  }
}
