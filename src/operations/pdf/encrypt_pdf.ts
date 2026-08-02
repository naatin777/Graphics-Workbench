import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { safeName, validateJobPaths } from './pdf_utils.js';

import {
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createSecurePdfStagingRoot } from '../lifecycle/secure_staging.js';
import { runQpdfWithJobJson } from './run_qpdf_with_job_json.js';

export interface EncryptPdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

export interface EncryptPdfOptions {
  jobs: EncryptPdfJob[];
  password: string;
  qpdfPath: string;
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function encryptPdfFiles(options: EncryptPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  await validateJobPaths(options.jobs, 'encrypt-pdf');

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.jobs);
  }

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? `${Date.now()}-${crypto.randomUUID()}`;
  const stagingRootPath = await createSecurePdfStagingRoot('encrypt-pdf');

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'encrypt-pdf',
    stagingOperationName: 'encrypt-pdf',
    runId,
    artifactRoots: [{ rootPath: stagingRootPath, workspacePath: stagingRootPath }],
    runtime: runtime ?? {},
    stage: async (job, index, _runId, batchRuntime) =>
      encryptPdf({
        job,
        index,
        password: options.password,
        qpdfPath: options.qpdfPath,
        stagingRootPath,
        signal: batchRuntime.signal,
      }),
  });
}

async function encryptPdf(params: {
  job: EncryptPdfJob;
  index: number;
  password: string;
  qpdfPath: string;
  stagingRootPath: string;
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput> {
  const { job, password, qpdfPath, signal } = params;
  signal?.throwIfAborted();

  const itemName = `${params.index + 1}-${safeName(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const workDirectory = path.join(params.stagingRootPath, itemName);
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(job.sourcePath, job.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, params.stagingRootPath);
  signal?.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  signal?.throwIfAborted();

  await runQpdfWithJobJson({
    qpdfPath,
    job: {
      inputFile: job.sourcePath,
      outputFile: stagedOutputPath,
      encrypt: { userPassword: password, ownerPassword: password, '256bit': {} },
    },
    ...(signal === undefined ? {} : { signal }),
    temporaryDirectory: params.stagingRootPath,
  });

  signal?.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath: params.stagingRootPath,
    stagingWorkspacePath: params.stagingRootPath,
  };
}

function validateJobs(jobs: EncryptPdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be encrypted: ${job.sourcePath}`);
    }
  }
}

async function assertOutputsDoNotExist(jobs: EncryptPdfJob[]): Promise<void> {
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
