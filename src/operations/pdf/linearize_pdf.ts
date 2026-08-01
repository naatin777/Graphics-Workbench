import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { runExternalTool } from '../external_tools/run_external_tool.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { safeName, validateJobPaths } from './pdf_utils.js';

import {
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';

export interface LinearizePdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface LinearizePdfOptions {
  jobs: LinearizePdfJob[];
  qpdfPath: string;
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function linearizePdfFiles(options: LinearizePdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  await validateJobPaths(options.jobs, 'linearize-pdf');

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.jobs);
  }

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? `${Date.now()}-${crypto.randomUUID()}`;

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'linearize-pdf',
    stagingOperationName: 'linearize-pdf',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      linearizePdf({
        job,
        index,
        qpdfPath: options.qpdfPath,
        runId: currentRunId,
        signal: batchRuntime.signal,
      }),
  });
}

async function linearizePdf(params: {
  job: LinearizePdfJob;
  index: number;
  qpdfPath: string;
  runId: string;
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput> {
  const { job, qpdfPath, runId, signal } = params;
  signal?.throwIfAborted();

  const itemName = `${params.index + 1}-${safeName(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const workDirectory = path.join(job.workspacePath, '.graphics-workbench', 'linearize-pdf', runId, itemName);
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

  await runExternalTool({
    toolName: 'qpdf',
    executable: qpdfPath,
    args: ['--linearize', copiedSourcePath, stagedOutputPath],
    ...(signal === undefined ? {} : { signal }),
  });

  signal?.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath: path.join(job.workspacePath, '.graphics-workbench', 'linearize-pdf', runId),
  };
}

function validateJobs(jobs: LinearizePdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be linearized: ${job.sourcePath}`);
    }
  }
}

async function assertOutputsDoNotExist(jobs: LinearizePdfJob[]): Promise<void> {
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
