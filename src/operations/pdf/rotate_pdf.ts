import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadMupdf, normalizeRotation, openPdfDocument, savePdfDocument, type MupdfPdfPage } from './mupdf.js';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';

export const PDF_ROTATION_ANGLES = [90, 180, 270] as const;
export type PdfRotationAngle = (typeof PDF_ROTATION_ANGLES)[number];

export interface RotatePdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  angle: PdfRotationAngle;
  /** 0-based page indices to rotate. When omitted, every page is rotated. */
  pageIndices?: number[];
}

export interface RotatePdfOptions {
  jobs: RotatePdfJob[];
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function rotatePdfFiles(options: RotatePdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  await validatePdfPathInputs(options.jobs, 'rotate-pdf');
  runtime?.signal?.throwIfAborted();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'rotate-pdf',
    runId: options.runId,
    ...(runtime !== undefined && { runtime }),
    stage: async (job, index, currentRunId, batchRuntime) =>
      rotatePdf({ job, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

async function rotatePdf(params: {
  job: RotatePdfJob;
  index: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { job, index, runId, signal } = params;
  signal.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(job.workspacePath, 'rotate-pdf', runId);
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

  await assertExistingPathInWorkspace(copiedSourcePath, job.workspacePath);
  signal.throwIfAborted();
  const mupdf = await loadMupdf();
  const sourceDocument = await openPdfDocument(await readFile(copiedSourcePath));
  try {
    signal.throwIfAborted();
    const pageCount = sourceDocument.countPages();

    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${job.sourcePath}`);
    }

    const pageIndices = job.pageIndices ?? Array.from({ length: pageCount }, (_, pageIndex) => pageIndex);
    validatePageIndices(pageIndices, pageCount, job.sourcePath);

    const outputDocument = new mupdf.PDFDocument();
    const rotateSet = new Set(pageIndices);
    try {
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        signal.throwIfAborted();
        outputDocument.graftPage(outputDocument.countPages(), sourceDocument, pageIndex);
        if (rotateSet.has(pageIndex)) {
          // graftPageは既存のRotate値を引き継ぐため、現在の回転に加算する。
          // 置換すると「90°回転済みページを90°回転」が無変化になる。
          const page = outputDocument.loadPage(pageIndex);
          // oxlint-disable-next-line max-depth -- Each resource needs a local try/finally for deterministic disposal.
          try {
            const currentRotation = readPageRotation(page);
            page.getObject().put('Rotate', normalizeRotation(currentRotation + job.angle));
          } finally {
            page.destroy();
          }
        }
      }
      await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
      signal.throwIfAborted();
      await writeFile(stagedOutputPath, savePdfDocument(outputDocument));
      signal.throwIfAborted();

      return {
        stagedOutputPath,
        outputPath: job.outputPath,
        workspacePath: job.workspacePath,
        stagingRootPath,
      };
    } finally {
      outputDocument.destroy();
    }
  } finally {
    sourceDocument.destroy();
  }
}

function validateJobs(jobs: RotatePdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be rotated: ${job.sourcePath}`);
    }

    if (!PDF_ROTATION_ANGLES.includes(job.angle)) {
      throw new Error(`Unsupported rotation angle: ${job.angle}`);
    }
  }
}

function validatePageIndices(pageIndices: number[], pageCount: number, sourcePath: string): void {
  for (const pageIndex of pageIndices) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
      throw new Error(`Page index ${pageIndex} is out of range for ${sourcePath}`);
    }
  }
}

function readPageRotation(page: MupdfPdfPage): number {
  const rotate = page.getObject().getInheritable('Rotate');
  return rotate.isNumber() ? rotate.asNumber() : 0;
}
