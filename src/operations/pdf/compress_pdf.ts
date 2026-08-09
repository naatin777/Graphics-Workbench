import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, stagingRootPathFor } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';
import { openPdfDocument, savePdfDocument } from './mupdf.js';

export interface CompressPdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface CompressPdfOptions {
  jobs: CompressPdfJob[];
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function compressPdfFiles(options: CompressPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  await validatePdfPathInputs(options.jobs, 'compress-pdf');

  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.jobs);
  }

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'compress-pdf',
    stagingOperationName: 'compress-pdf',
    runId,
    ...(runtime !== undefined && { runtime }),
    stage: async (job, index, currentRunId, batchRuntime) =>
      compressPdf({
        job,
        index,
        runId: currentRunId,
        signal: batchRuntime.signal,
      }),
  });
}

async function compressPdf(params: {
  job: CompressPdfJob;
  index: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { job, runId, signal } = params;
  signal.throwIfAborted();

  const itemName = `${params.index + 1}-${sanitizePdfPathSegment(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(job.workspacePath, 'compress-pdf', runId);
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

  const document = await openPdfDocument(await readFile(copiedSourcePath));
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = savePdfDocument(document, 'garbage=4,compress=yes,compression-effort=10');
  } finally {
    document.destroy();
  }
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

function validateJobs(jobs: CompressPdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be compressed: ${job.sourcePath}`);
    }
  }
}

async function assertOutputsDoNotExist(jobs: CompressPdfJob[]): Promise<void> {
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

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
