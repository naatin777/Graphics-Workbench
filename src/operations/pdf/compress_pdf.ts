import { execFile } from 'node:child_process';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { safeName, validateJobPaths } from './pdf_utils.js';

import {
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';

const execFileAsync = promisify(execFile);

export interface CompressPdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export type GhostscriptQuality = 'screen' | 'ebook' | 'printer' | 'prepress' | 'default';

export interface CompressPdfOptions {
  jobs: CompressPdfJob[];
  quality: GhostscriptQuality;
  ghostscriptPath: string;
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function compressPdfFiles(options: CompressPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  await validateJobPaths(options.jobs, 'compress-pdf');

  await assertPreflightPassed(options.jobs, preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.jobs);
  }

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? `${Date.now()}-${crypto.randomUUID()}`;

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'compress-pdf',
    stagingOperationName: 'compress-pdf',
    runId,
    runtime: runtime ?? {},
    stage: (job, index, currentRunId, batchRuntime) =>
      compressPdf({
        job,
        index,
        quality: options.quality,
        ghostscriptPath: options.ghostscriptPath,
        runId: currentRunId,
        signal: batchRuntime.signal,
      }),
  });
}

async function compressPdf(params: {
  job: CompressPdfJob;
  index: number;
  quality: GhostscriptQuality;
  ghostscriptPath: string;
  runId: string;
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput> {
  const { job, quality, ghostscriptPath, runId, signal } = params;
  signal?.throwIfAborted();

  const itemName = `${params.index + 1}-${safeName(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const workDirectory = path.join(job.workspacePath, '.latex-graphics-helper', 'compress-pdf', runId, itemName);
  const copiedSourcePath = path.join(workDirectory, path.basename(job.sourcePath));
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(job.sourcePath, job.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, job.workspacePath);
  signal?.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  await copyFile(job.sourcePath, copiedSourcePath);
  await assertExistingPathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();

  await execFileAsync(
    ghostscriptPath,
    [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-dQUIET',
      '-sDEVICE=pdfwrite',
      `-dPDFSETTINGS=/${quality}`,
      '-dCompatibilityLevel=1.4',
      `-sOutputFile=${stagedOutputPath}`,
      copiedSourcePath,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      signal,
    },
  );

  signal?.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath: path.join(job.workspacePath, '.latex-graphics-helper', 'compress-pdf', runId),
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
