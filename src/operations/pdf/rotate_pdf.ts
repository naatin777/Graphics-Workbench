import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, degrees } from 'pdf-lib';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { safeName, validateJobPaths } from './pdf_utils.js';

import {
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
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
  await validateJobPaths(options.jobs, 'rotate-pdf');
  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'rotate-pdf',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      rotatePdf({ job, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

async function rotatePdf(params: {
  job: RotatePdfJob;
  index: number;
  runId: string;
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput> {
  const { job, index, runId, signal } = params;
  signal?.throwIfAborted();

  const itemName = `${index + 1}-${safeName(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = createStagingRoot(job.workspacePath, 'rotate-pdf', runId);
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

  await assertExistingPathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  const sourceDocument = await PDFDocument.load(await readFile(copiedSourcePath));
  signal?.throwIfAborted();
  const pageCount = sourceDocument.getPageCount();

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${job.sourcePath}`);
  }

  const pageIndices = job.pageIndices ?? Array.from({ length: pageCount }, (_, pageIndex) => pageIndex);
  validatePageIndices(pageIndices, pageCount, job.sourcePath);

  const outputDocument = await PDFDocument.create();
  const copiedPages = await outputDocument.copyPages(sourceDocument, sourceDocument.getPageIndices());

  if (copiedPages.length !== pageCount) {
    throw new Error(`Could not copy all pages: ${job.sourcePath}`);
  }

  const rotateSet = new Set(pageIndices);

  for (const [pageIndex, copiedPage] of copiedPages.entries()) {
    signal?.throwIfAborted();
    if (rotateSet.has(pageIndex)) {
      copiedPage.setRotation(degrees(job.angle));
    }
    outputDocument.addPage(copiedPage);
  }

  await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
  signal?.throwIfAborted();
  await writeFile(stagedOutputPath, await outputDocument.save());
  signal?.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath,
  };
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
