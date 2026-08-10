import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { openPdfDocument, savePdfDocument } from './mupdf.js';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';

interface ReorderPdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  /** 1-based page numbers in the desired output order. Must be a permutation of 1..pageCount. */
  pageOrder: number[];
}

export interface ReorderPdfOptions {
  inputs: ReorderPdfInput[];
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function reorderPdfFiles(options: ReorderPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateConversions(options.inputs);
  await validatePdfPathInputs(options.inputs, 'reorder-pdf');
  runtime?.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'reorder-pdf',
    runId: options.runId,
    ...(runtime !== undefined && { runtime }),
    stage: async (input, index, currentRunId, batchRuntime) =>
      reorderPdf({ input, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

async function reorderPdf(params: {
  input: ReorderPdfInput;
  index: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { input, index, runId, signal } = params;
  signal.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'reorder-pdf', runId);
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
  const sourceDocument = await openPdfDocument(await readFile(copiedSourcePath));
  try {
    signal.throwIfAborted();
    const pageCount = sourceDocument.countPages();

    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${input.sourcePath}`);
    }

    validatePageOrder(input.pageOrder, pageCount, input.sourcePath);

    signal.throwIfAborted();
    sourceDocument.rearrangePages(input.pageOrder.map((page) => page - 1));
    signal.throwIfAborted();

    await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
    signal.throwIfAborted();
    await writeFile(stagedOutputPath, savePdfDocument(sourceDocument));
    signal.throwIfAborted();

    return {
      stagedOutputPath,
      outputPath: input.outputPath,
      workspacePath: input.workspacePath,
      stagingRootPath,
    };
  } finally {
    sourceDocument.destroy();
  }
}

function validateConversions(inputs: ReorderPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be reordered: ${input.sourcePath}`);
    }
  }
}

function validatePageOrder(pageOrder: number[], pageCount: number, sourcePath: string): void {
  if (pageOrder.length !== pageCount) {
    throw new Error(`Page order must contain exactly ${pageCount} pages: ${sourcePath}`);
  }

  const seen = new Set<number>();

  for (const page of pageOrder) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is out of range for ${sourcePath}`);
    }
    if (seen.has(page)) {
      throw new Error(`Page ${page} appears more than once for ${sourcePath}`);
    }
    seen.add(page);
  }
}
