import pLimit from 'p-limit';

import { isAbortError } from '../../application/error_utils.js';
import {
  stagingArtifactsForJobs,
  type ConversionArtifactRoot,
  withStagingCleanup,
} from './cleanup_conversion_artifacts.js';
import {
  commitStagedOutputs,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from './commit_conversion_outputs.js';
import type { ConversionExecutionContext } from './conversion_runtime.js';

const CONVERSION_CONCURRENCY = 2;

export interface StagedConversionBatch<Job extends { workspacePath: string }> {
  jobs: Job[];
  operationName: string;
  stagingOperationName?: string;
  runId: string;
  artifactRoots?: readonly ConversionArtifactRoot[];
  runtime?: ConversionExecutionContext;
  stage: (
    job: Job,
    index: number,
    runId: string,
    runtime: ConversionExecutionContext,
  ) => Promise<PreparedConversionOutput | PreparedConversionOutput[]>;
}

/** Runs the shared staging/commit lifecycle; source dispatch stays with each operation. */
export async function runStagedConversionBatch<Job extends { workspacePath: string }>(
  options: StagedConversionBatch<Job>,
): Promise<CommittedConversionOutput[]> {
  const runtime = options.runtime ?? {};
  const artifacts =
    options.artifactRoots ??
    stagingArtifactsForJobs(options.jobs, options.stagingOperationName ?? options.operationName, options.runId);
  const abortController = new AbortController();
  const abortFromCaller = (): void => {
    abortController.abort(options.runtime?.signal?.reason);
  };

  if (options.runtime?.signal?.aborted === true) {
    abortFromCaller();
  } else {
    options.runtime?.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const batchRuntime: ConversionExecutionContext = {
    ...runtime,
    signal: abortController.signal,
  };
  const signal = abortController.signal;

  try {
    return await withStagingCleanup(
      artifacts,
      async () => {
        const limit = pLimit(CONVERSION_CONCURRENCY);
        let completedCount = 0;
        const settled = await Promise.allSettled(
          options.jobs.map(async (job, index) =>
            limit(async () => {
              batchRuntime.signal?.throwIfAborted();
              try {
                const output = await options.stage(job, index, options.runId, batchRuntime);
                completedCount += 1;
                options.runtime?.reportProgress?.(completedCount, options.jobs.length);
                return output;
              } catch (error) {
                const stageError = error instanceof Error ? error : new Error(String(error));
                abortController.abort(stageError);
                throw stageError;
              }
            }),
          ),
        );
        const failure =
          settled.find((result) => result.status === 'rejected' && !isAbortError(result.reason)) ??
          settled.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') {
          throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
        }

        signal.throwIfAborted();
        const stagedOutputs = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
        const commitOptions: CommitConversionOutputsOptions = { signal, operationName: options.operationName };
        if (runtime.resolveConflicts !== undefined) {
          commitOptions.resolveConflicts = runtime.resolveConflicts;
        }
        if (runtime.outputChannel !== undefined) {
          commitOptions.outputChannel = runtime.outputChannel;
        }
        return commitStagedOutputs(stagedOutputs, commitOptions);
      },
      runtime.outputChannel,
    );
  } finally {
    options.runtime?.signal?.removeEventListener('abort', abortFromCaller);
  }
}
