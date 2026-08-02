import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { safeName } from './pdf_utils.js';

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
  runId?: string;
}

export async function cropPdfWithConfiguredBox(options: CropPdfConfigureOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  await validateJobPaths(options.job);

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? `${Date.now()}-${randomUUID()}`;
  const stagingRootPath = path.join(options.job.workspacePath, '.graphics-workbench', 'crop-pdf-configure', runId);
  const artifacts: ConversionArtifactRoot[] = [{ rootPath: stagingRootPath, workspacePath: options.job.workspacePath }];

  try {
    const preparedOutput = await createConfiguredCropOutput(options, runId);

    runtime?.signal?.throwIfAborted();
    const commitOptions: CommitConversionOutputsOptions = { operationName: 'crop-pdf-configure' as const };
    if (runtime?.signal !== undefined) {
      commitOptions.signal = runtime.signal;
    }
    if (runtime?.resolveConflicts !== undefined) {
      commitOptions.resolveConflicts = runtime.resolveConflicts;
    }
    if (runtime?.outputChannel !== undefined) {
      commitOptions.outputChannel = runtime.outputChannel;
    }
    return await commitStagedOutputs([preparedOutput], commitOptions);
  } catch (error) {
    await cleanupConversionArtifacts(artifacts, runtime?.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function createConfiguredCropOutput(
  options: CropPdfConfigureOptions,
  runId: string,
): Promise<PreparedConversionOutput> {
  const { job, runtime } = options;
  const signal = runtime?.signal;
  const workDirectory = path.join(
    job.workspacePath,
    '.graphics-workbench',
    'crop-pdf-configure',
    runId,
    safeName(path.basename(job.sourcePath, path.extname(job.sourcePath))),
  );
  const copiedSourcePath = path.join(workDirectory, path.basename(job.sourcePath));
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(workDirectory, job.workspacePath);
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  await copyFile(job.sourcePath, copiedSourcePath);
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
  );
  signal?.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath: path.join(job.workspacePath, '.graphics-workbench', 'crop-pdf-configure', runId),
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
