import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfJobPaths } from './pdf_job_paths.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';

interface ReorderPdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  /** 1-based page numbers in the desired output order. Must be a permutation of 1..pageCount. */
  pageOrder: number[];
}

export interface ReorderPdfOptions {
  jobs: ReorderPdfJob[];
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function reorderPdfFiles(options: ReorderPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  await validatePdfJobPaths(options.jobs, 'reorder-pdf');
  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'reorder-pdf',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      reorderPdf({ job, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

async function reorderPdf(params: {
  job: ReorderPdfJob;
  index: number;
  runId: string;
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput> {
  const { job, index, runId, signal } = params;
  signal?.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = createStagingRoot(job.workspacePath, 'reorder-pdf', runId);
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

  validatePageOrder(job.pageOrder, pageCount, job.sourcePath);

  const outputDocument = await PDFDocument.create();
  const copiedPages = await outputDocument.copyPages(
    sourceDocument,
    job.pageOrder.map((page) => page - 1),
  );

  if (copiedPages.length !== job.pageOrder.length) {
    throw new Error(`Could not copy all pages: ${job.sourcePath}`);
  }

  for (const copiedPage of copiedPages) {
    signal?.throwIfAborted();
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

function validateJobs(jobs: ReorderPdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be reordered: ${job.sourcePath}`);
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
