import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, stagingRootPathFor } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';
import {
  findVisibleContentBounds,
  loadMupdf,
  openPdfDocument,
  savePdfDocument,
  type MupdfModule,
  type MupdfPdfObject,
  type MupdfPdfPage,
} from './mupdf.js';

export interface CropPdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface CropPdfOptions {
  jobs: CropPdfJob[];
  margin: number;
  runtime?: ConversionExecutionContext;
  runId?: string;
}

type Rect = [number, number, number, number];

export async function cropPdfFiles(options: CropPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  validateMargin(options.margin);
  await validatePdfPathInputs(options.jobs, 'crop-pdf');

  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.jobs);
  }

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'crop-pdf-auto',
    stagingOperationName: 'crop-pdf',
    runId,
    ...(runtime !== undefined && { runtime }),
    stage: async (job, index, currentRunId, batchRuntime) =>
      convertPdf({
        job,
        index,
        margin: options.margin,
        runId: currentRunId,
        signal: batchRuntime.signal,
      }),
  });
}

async function convertPdf(params: {
  job: CropPdfJob;
  index: number;
  margin: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { job, index, margin, runId, signal } = params;
  signal.throwIfAborted();
  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(job.workspacePath, 'crop-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const copiedSourcePath = path.join(workDirectory, path.basename(job.sourcePath));
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(job.sourcePath, job.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, job.workspacePath);
  signal.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  signal.throwIfAborted();
  await copyFileWithAbort(job.sourcePath, copiedSourcePath, undefined, signal);

  const pdfBytes = await cropDocumentBytes(await readFile(copiedSourcePath), margin, job.sourcePath, signal);
  signal.throwIfAborted();
  await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
  signal.throwIfAborted();
  await writeFile(stagedOutputPath, pdfBytes);
  signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
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

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      signal.throwIfAborted();
      setPageBounds(document.loadPage(pageIndex), margin, mupdf);
    }

    signal.throwIfAborted();
    return savePdfDocument(document);
  } catch (error) {
    document.destroy();
    throw error instanceof Error ? error : new Error(String(error));
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

function asRect(value: unknown): Rect | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  const items: unknown[] = value;
  const x1 = toFiniteNumber(items[0]);
  const y1 = toFiniteNumber(items[1]);
  const x2 = toFiniteNumber(items[2]);
  const y2 = toFiniteNumber(items[3]);
  if (x1 === null || y1 === null || x2 === null || y2 === null) {
    return null;
  }
  return [x1, y1, x2, y2];
}

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
function validateJobs(jobs: CropPdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be cropped: ${job.sourcePath}`);
    }
  }
}

function validateMargin(margin: number): void {
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(`Crop margin must be a non-negative number: ${margin}`);
  }
}

async function assertOutputsDoNotExist(jobs: CropPdfJob[]): Promise<void> {
  const normalizedOutputs = new Set<string>();

  for (const job of jobs) {
    const normalizedOutput = path.resolve(job.outputPath);

    if (normalizedOutputs.has(normalizedOutput)) {
      throw new Error(`Multiple inputs resolve to the same output: ${job.outputPath}`);
    }
    normalizedOutputs.add(normalizedOutput);

    try {
      await access(job.outputPath);
      throw new Error(`Output file already exists: ${job.outputPath}`);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        continue;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

function addMargin(box: Rect, margin: number): Rect {
  return [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin];
}

function isEmptyBox(box: Rect): boolean {
  return box[0] === box[2] || box[1] === box[3];
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
