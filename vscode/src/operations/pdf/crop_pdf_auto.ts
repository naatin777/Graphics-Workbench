import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as v from 'valibot';

import {
  assertExistingPathInWorkspace,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type {
  CommittedConversionOutput,
  PreparedConversionOutput,
} from '@graphics-workbench/core/operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '@graphics-workbench/core/operations/lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '@graphics-workbench/core/operations/lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '@graphics-workbench/core/operations/lifecycle/run_id.js';
import { copyFileWithAbort } from '@graphics-workbench/core/operations/lifecycle/copy_file_with_abort.js';
import {
  findVisibleContentBounds,
  loadMupdf,
  openPdfDocument,
  savePdfDocument,
  type MupdfModule,
  type MupdfPdfObject,
  type MupdfPdfPage,
} from '@graphics-workbench/core/operations/pdf/mupdf.js';

export interface CropPdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface CropPdfOptions {
  inputs: CropPdfInput[];
  margin: number;
  runtime: ConversionExecutionContext;
  runId?: string;
}

type Rect = [number, number, number, number];

export async function cropPdfFiles(options: CropPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime.signal?.throwIfAborted();
  validateConversions(options.inputs);
  validateMargin(options.margin);
  await validatePdfPathInputs(options.inputs, 'crop-pdf');

  runtime.signal?.throwIfAborted();

  runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'crop-pdf-auto',
    stagingOperationName: 'crop-pdf',
    runId: options.runId,
    runtime,
    stage: async (input, index, currentRunId, batchRuntime) =>
      convertPdf({
        input,
        index,
        margin: options.margin,
        runId: currentRunId,
        signal: batchRuntime.signal,
      }),
  });
}

async function convertPdf(params: {
  input: CropPdfInput;
  index: number;
  margin: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { input, index, margin, runId, signal } = params;
  signal.throwIfAborted();
  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'crop-pdf', runId);
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

  const pdfBytes = await cropDocumentBytes(await readFile(copiedSourcePath), margin, input.sourcePath, signal);
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

async function cropDocumentBytes(
  sourceBytes: Uint8Array,
  margin: number,
  sourcePath: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(sourceBytes);
  try {
    signal.throwIfAborted();
    const pageCount = document.countPages();
    if (pageCount === 0) {
      throw new Error(`Could not determine all PDF page bounds: ${sourcePath}`);
    }

    // oxlint-disable-next-line no-unreachable-loop -- crop each PDF page independently.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      signal.throwIfAborted();
      const page = document.loadPage(pageIndex);
      try {
        setPageBounds(page, margin, mupdf);
      } finally {
        page.destroy();
      }
    }

    signal.throwIfAborted();
    return savePdfDocument(document);
  } finally {
    document.destroy();
  }
}

function setPageBounds(page: MupdfPdfPage, margin: number, mupdf: MupdfModule): void {
  const pageObject = page.getObject();
  const mediaBox = readRawMediaBox(pageObject);
  const contentBounds = findVisibleContentBounds(page, mupdf);

  if (contentBounds === undefined || isEmptyBox(contentBounds)) {
    if (mediaBox !== null) {
      pageObject.put('CropBox', mediaBox);
    }
    return;
  }

  const cropBox = addMargin(contentBounds, margin);
  pageObject.put('MediaBox', cropBox);
  pageObject.put('CropBox', cropBox);
}

function readRawMediaBox(pageObject: MupdfPdfObject): Rect | null {
  const value = pageObject.getInheritable('MediaBox').asJS();
  const rect = asRect(value);
  if (rect === null) {
    return null;
  }
  return rect;
}

const MediaBoxSchema = v.tuple([
  v.pipe(v.number(), v.finite()),
  v.pipe(v.number(), v.finite()),
  v.pipe(v.number(), v.finite()),
  v.pipe(v.number(), v.finite()),
]);

// mupdfのasJS()が返すMediaBox配列を検証してRectへ変換する。
// oxlint-disable-next-line typescript/no-restricted-types -- mupdf.asJS()が返す未検証PDF値をvalibotで検証する境界。
function asRect(value: unknown): Rect | null {
  const result = v.safeParse(MediaBoxSchema, value);
  if (!result.success) {
    return null;
  }
  const [left, bottom, right, top] = result.output;
  return [left, bottom, right, top];
}
function validateConversions(inputs: CropPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be cropped: ${input.sourcePath}`);
    }
  }
}

function validateMargin(margin: number): void {
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(`Crop margin must be a non-negative number: ${margin}`);
  }
}

function addMargin(box: Rect, margin: number): Rect {
  return [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin];
}

function isEmptyBox(box: Rect): boolean {
  return box[0] === box[2] || box[1] === box[3];
}
