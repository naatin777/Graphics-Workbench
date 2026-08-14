import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '@graphics-workbench/core/security';
import { validatePdfPathInputs, type CropBox, type CropTarget } from '@graphics-workbench/core/pdf';
import {
  copyFileWithAbort,
  isAbortError,
  OperationCancelledError,
  runStagedConversionBatch,
  stagingRootPathFor,
  type CommittedConversionOutput,
  type ConversionExecutionContext,
  type PreparedConversionOutput,
  type ResolvedConversionRuntime,
  type RunId,
} from '@graphics-workbench/core/runtime';

import { runCropWorker } from '@graphics-workbench/core/crop-worker';
import { matchError } from 'better-result';

export type { CropBox } from '@graphics-workbench/core/pdf';

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

  runtime?.signal?.throwIfAborted();

  try {
    const outputs = await runStagedConversionBatch({
      inputs: [options.input],
      operationName: 'crop-pdf-configure',
      stagingOperationName: 'crop-pdf-configure',
      runId: options.createRunId?.(),
      runtime: options.runtime ?? {},
      stage: async (input, _index, currentRunId, batchRuntime) =>
        prepareConfiguredCropOutput(input, currentRunId, batchRuntime),
    });
    runtime?.outputChannel?.appendLine('[crop-pdf-configure] operation-completed');
    return outputs;
  } catch (error) {
    appendCropConfigureFailureLogs(runtime?.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
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
  input: ConfiguredCropPdfInput,
  runId: string,
  runtime: ResolvedConversionRuntime,
): Promise<PreparedConversionOutput> {
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'crop-pdf-configure', runId);
  const workDirectory = path.join(stagingRootPath, 'item-1');
  const copiedSourcePath = path.join(workDirectory, 'input.pdf');
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(workDirectory, input.workspacePath);
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, input.workspacePath);
  await copyFileWithAbort(input.sourcePath, copiedSourcePath, undefined, runtime.signal);
  await assertExistingPathInWorkspace(copiedSourcePath, input.workspacePath);

  runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
  runtime.signal.throwIfAborted();
  const cropResult = await runCropWorker(
    {
      type: 'crop',
      request: {
        sourcePath: copiedSourcePath,
        stagedOutputPath,
        cropBox: input.cropBox,
        target: input.target,
      },
    },
    runtime.signal,
    runtime.outputChannel === undefined ? undefined : { outputChannel: runtime.outputChannel },
  );
  if (cropResult.isErr()) {
    throw matchError(cropResult.error, {
      CropWorkerCancelledError: (error) => new OperationCancelledError(error.message),
      CropWorkerFailedError: (error) => error,
    });
  }
  runtime.signal.throwIfAborted();
  await assertExistingPathInWorkspace(stagedOutputPath, input.workspacePath);
  runtime.outputChannel?.appendLine('[crop-pdf-configure] staging-validated');

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}
