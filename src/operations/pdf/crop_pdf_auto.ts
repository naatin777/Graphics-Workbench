import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfJobPaths } from './pdf_job_paths.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';
import {
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

const MAX_CONTENT_RENDER_PIXELS = 50_000_000;

export async function cropPdfFiles(options: CropPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  validateMargin(options.margin);
  await validatePdfJobPaths(options.jobs, 'crop-pdf');

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
    runtime: runtime ?? {},
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
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput> {
  const { job, index, margin, runId, signal } = params;
  signal?.throwIfAborted();
  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = createStagingRoot(job.workspacePath, 'crop-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const copiedSourcePath = path.join(workDirectory, path.basename(job.sourcePath));
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(job.sourcePath, job.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, job.workspacePath);
  signal?.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  await copyFileWithAbort(job.sourcePath, copiedSourcePath, undefined, signal);

  const pdfBytes = await cropDocumentBytes(await readFile(copiedSourcePath), margin, job.sourcePath, signal);
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
  signal?.throwIfAborted();
  await writeFile(stagedOutputPath, pdfBytes);
  signal?.throwIfAborted();

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
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(sourceBytes);
  try {
    signal?.throwIfAborted();
    const pageCount = document.countPages();
    if (pageCount === 0) {
      throw new Error(`Could not determine all PDF page bounds: ${sourcePath}`);
    }

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      signal?.throwIfAborted();
      setPageBounds(document.loadPage(pageIndex), margin, mupdf);
    }

    signal?.throwIfAborted();
    return savePdfDocument(document);
  } catch (error) {
    document.destroy();
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function setPageBounds(page: MupdfPdfPage, margin: number, mupdf: MupdfModule): void {
  const pageObject = page.getObject();
  const mediaBox = readRawMediaBox(pageObject);
  const contentBounds = contentBoundsForPage(page, mupdf);

  if (contentBounds === null || isEmptyBox(contentBounds)) {
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
function contentBoundsForPage(page: MupdfPdfPage, mupdf: MupdfModule): Rect | null {
  const [x0, y0, x1, y1] = page.getBounds('MediaBox');
  const width = x1 - x0;
  const height = y1 - y0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  // ponytail: mupdf's page.toDisplayList().getBounds() returns the mediabox, not the content
  // bounds (fz_bound_display_list returns list->mediabox). Detect content by rendering the
  // page to a transparent pixmap and scanning for non-transparent pixels.
  const pixelCount = Math.ceil(width) * Math.ceil(height);
  const scale = pixelCount > MAX_CONTENT_RENDER_PIXELS ? Math.sqrt(MAX_CONTENT_RENDER_PIXELS / pixelCount) : 1;
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, true);
  try {
    const pixmapWidth = pixmap.getWidth();
    const pixmapHeight = pixmap.getHeight();
    if (pixmapWidth <= 0 || pixmapHeight <= 0) {
      return null;
    }

    const pixelBounds = contentPixelBounds(pixmapWidth, pixmapHeight, pixmap.getPixels());
    if (pixelBounds === null) {
      return null;
    }

    const [minX, minY, maxX, maxY] = pixelBounds;
    const deviceRect: Rect = [minX / scale, minY / scale, maxX / scale, maxY / scale];
    return mupdf.Rect.transform(deviceRect, mupdf.Matrix.invert(page.getTransform()));
  } finally {
    pixmap.destroy();
  }
}

function contentPixelBounds(
  pixmapWidth: number,
  pixmapHeight: number,
  pixels: Uint8ClampedArray,
): [number, number, number, number] | null {
  let minX = pixmapWidth;
  let minY = pixmapHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < pixmapHeight; y += 1) {
    let index = y * pixmapWidth * 4;
    for (let x = 0; x < pixmapWidth; x += 1) {
      if ((pixels[index + 3] ?? 0) > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      index += 4;
    }
  }
  if (maxX < 0) {
    return null;
  }
  return [minX, minY, maxX + 1, maxY + 1];
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
