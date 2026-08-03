import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { assertSafePathSegment, createRunId, createStagingRoot, type RunId } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';

import { isAbortError } from '../../application/error_utils.js';
import { cleanupConversionArtifacts, type ConversionArtifactRoot } from '../lifecycle/cleanup_conversion_artifacts.js';
import {
  commitStagedOutputs,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runCropPdfProcess } from './run_crop_pdf_process.js';
import { type CropBox, type CropTarget } from './crop_pdf_core.js';

export type { CropBox } from './crop_pdf_core.js';

interface CropPdfConfigureJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  cropBox: CropBox;
  target: CropTarget;
}

export interface CropPdfConfigureOptions {
  job: CropPdfConfigureJob;
  runtime?: ConversionExecutionContext;
  createRunId?: () => RunId;
}

export async function cropPdfWithConfiguredBox(options: CropPdfConfigureOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  await validateJobPaths(options.job);

  runtime?.outputChannel?.appendLine('[crop-pdf-configure] operation-started');

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const runId = options.createRunId?.() ?? createRunId();
  assertSafePathSegment(runId, 'runId');
  const stagingRootPath = createStagingRoot(options.job.workspacePath, 'crop-pdf-configure', runId);
  const artifacts: ConversionArtifactRoot[] = [{ rootPath: stagingRootPath, workspacePath: options.job.workspacePath }];

  try {
    const preparedOutput = await createConfiguredCropOutput(options, runId);

    runtime?.signal?.throwIfAborted();
    const commitOptions = createCommitOptions(runtime);
    const outputs = await commitStagedOutputs([preparedOutput], commitOptions);
    runtime?.outputChannel?.appendLine('[crop-pdf-configure] operation-completed');
    return outputs;
  } catch (error) {
    await cleanupConversionArtifacts(artifacts, runtime?.outputChannel, error);
    appendCropConfigureFailureLogs(runtime?.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function createCommitOptions(runtime: ConversionExecutionContext | undefined): CommitConversionOutputsOptions {
  const options: CommitConversionOutputsOptions = { operationName: 'crop-pdf-configure' };
  if (runtime?.signal !== undefined) {
    options.signal = runtime.signal;
  }
  if (runtime?.resolveConflicts !== undefined) {
    options.resolveConflicts = runtime.resolveConflicts;
  }
  if (runtime?.outputChannel !== undefined) {
    options.outputChannel = runtime.outputChannel;
  }
  return options;
}

function appendCropConfigureFailureLogs(
  outputChannel: ConversionExecutionContext['outputChannel'],
  error: unknown,
): void {
  outputChannel?.appendLine('[crop-pdf-configure] staging-cleaned');
  outputChannel?.appendLine(`[crop-pdf-configure] ${isAbortError(error) ? 'operation-cancelled' : 'operation-failed'}`);
}

async function createConfiguredCropOutput(
  options: CropPdfConfigureOptions,
  runId: RunId,
): Promise<PreparedConversionOutput> {
  const { job, runtime } = options;
  const signal = runtime?.signal;
  const stagingRootPath = createStagingRoot(job.workspacePath, 'crop-pdf-configure', runId);
  const workDirectory = path.join(stagingRootPath, 'item-1');
  const copiedSourcePath = path.join(workDirectory, 'input.pdf');
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(workDirectory, job.workspacePath);
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  await copyFileWithAbort(job.sourcePath, copiedSourcePath, undefined, signal);
  await assertExistingPathInWorkspace(copiedSourcePath, job.workspacePath);

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
  signal?.throwIfAborted();
  await runCropPdfProcess(
    {
      sourcePath: copiedSourcePath,
      stagedOutputPath,
      cropBox: job.cropBox,
      target: job.target,
    },
    signal,
    {
      ...(runtime?.outputChannel !== undefined && { outputChannel: runtime.outputChannel }),
    },
  );
  signal?.throwIfAborted();
  await assertExistingPathInWorkspace(stagedOutputPath, job.workspacePath);
  runtime?.outputChannel?.appendLine('[crop-pdf-configure] staging-validated');

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath,
  };
}

async function validateJobPaths(job: CropPdfConfigureJob): Promise<void> {
  await Promise.all([
    assertExistingPathInWorkspace(job.sourcePath, job.workspacePath),
    assertWritablePathInWorkspace(job.outputPath, job.workspacePath),
    assertWritablePathInWorkspace(
      path.join(job.workspacePath, '.graphics-workbench', 'crop-pdf-configure'),
      job.workspacePath,
    ),
  ]);
}
