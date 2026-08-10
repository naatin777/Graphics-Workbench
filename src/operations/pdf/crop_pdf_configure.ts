import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { validatePdfPathInputs } from './pdf_path_validation.js';
import { assertSafePathSegment, createRunId, stagingRootPathFor, type RunId } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';

import { isAbortError } from '../../shared/error.js';
import { cleanupConversionArtifacts, type ConversionArtifactRoot } from '../lifecycle/cleanup_conversion_artifacts.js';
import {
  commitStagedOutputs,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runCropPdfProcess } from './run_crop_pdf_process.js';
import type { CropBox, CropTarget } from './crop_pdf_core.js';

export type { CropBox } from './crop_pdf_core.js';

interface ConfiguredCropPdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  cropBox: CropBox;
  target: CropTarget;
}

export interface CropPdfConfigureOptions {
  input: ConfiguredCropPdfInput;
  runtime?: ConversionExecutionContext;
  createRunId?: () => RunId;
}

export async function cropPdfWithConfiguredBox(options: CropPdfConfigureOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  await validatePdfPathInputs([options.input], 'crop-pdf-configure');

  runtime?.outputChannel?.appendLine('[crop-pdf-configure] operation-started');

  runtime?.signal?.throwIfAborted();

  const runId = options.createRunId?.() ?? createRunId();
  assertSafePathSegment(runId, 'runId');
  const stagingRootPath = stagingRootPathFor(options.input.workspacePath, 'crop-pdf-configure', runId);
  const artifacts: ConversionArtifactRoot[] = [
    { rootPath: stagingRootPath, workspacePath: options.input.workspacePath },
  ];

  try {
    const preparedOutput = await prepareConfiguredCropOutput(options, runId);

    runtime?.signal?.throwIfAborted();
    const commitOptions = buildCommitOptions(runtime);
    const outputs = await commitStagedOutputs([preparedOutput], commitOptions);
    runtime?.outputChannel?.appendLine('[crop-pdf-configure] operation-completed');
    return outputs;
  } catch (error) {
    await cleanupConversionArtifacts(artifacts, runtime?.outputChannel, error);
    appendCropConfigureFailureLogs(runtime?.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function buildCommitOptions(runtime: ConversionExecutionContext | undefined): CommitConversionOutputsOptions {
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
  // oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
  error: unknown,
): void {
  outputChannel?.appendLine('[crop-pdf-configure] staging-cleaned');
  outputChannel?.appendLine(`[crop-pdf-configure] ${isAbortError(error) ? 'operation-cancelled' : 'operation-failed'}`);
}

async function prepareConfiguredCropOutput(
  options: CropPdfConfigureOptions,
  runId: RunId,
): Promise<PreparedConversionOutput> {
  const { input, runtime } = options;
  const signal = runtime?.signal;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'crop-pdf-configure', runId);
  const workDirectory = path.join(stagingRootPath, 'item-1');
  const copiedSourcePath = path.join(workDirectory, 'input.pdf');
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(workDirectory, input.workspacePath);
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, input.workspacePath);
  await copyFileWithAbort(input.sourcePath, copiedSourcePath, undefined, signal);
  await assertExistingPathInWorkspace(copiedSourcePath, input.workspacePath);

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
  signal?.throwIfAborted();
  await runCropPdfProcess(
    {
      sourcePath: copiedSourcePath,
      stagedOutputPath,
      cropBox: input.cropBox,
      target: input.target,
    },
    signal,
    {
      ...(runtime?.outputChannel !== undefined && { outputChannel: runtime.outputChannel }),
    },
  );
  signal?.throwIfAborted();
  await assertExistingPathInWorkspace(stagedOutputPath, input.workspacePath);
  runtime?.outputChannel?.appendLine('[crop-pdf-configure] staging-validated');

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}
