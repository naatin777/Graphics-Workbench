import { isAbortError } from '../../shared/error.js';
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
import type { ConversionExecutionContext, ResolvedConversionRuntime } from './conversion_runtime.js';
import { sharedConversionJobLimiter } from '../external_tools/heavy_process_limiter.js';
import { createRunId } from './run_id.js';

export interface StagedConversionBatch<Job extends { workspacePath: string }> {
  jobs: Job[];
  operationName: string;
  stagingOperationName?: string;
  runId?: string | undefined;
  artifactRoots?: readonly ConversionArtifactRoot[];
  runtime?: ConversionExecutionContext;
  stage: (
    job: Job,
    index: number,
    runId: string,
    runtime: ResolvedConversionRuntime,
  ) => Promise<PreparedConversionOutput | PreparedConversionOutput[]>;
}

/** Runs the shared staging/commit lifecycle; source dispatch stays with each operation. */
export async function runStagedConversionBatch<Job extends { workspacePath: string }>(
  options: StagedConversionBatch<Job>,
): Promise<CommittedConversionOutput[]> {
  const runtime = options.runtime ?? {};
  const runId = options.runId ?? createRunId();
  const artifacts =
    options.artifactRoots ??
    stagingArtifactsForJobs(options.jobs, options.stagingOperationName ?? options.operationName, runId);
  const abortController = new AbortController();
  const abortFromCaller = (): void => {
    abortController.abort(runtime.signal?.reason);
  };

  if (runtime.signal?.aborted === true) {
    abortFromCaller();
  } else {
    runtime.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const batchRuntime: ResolvedConversionRuntime = {
    ...runtime,
    signal: abortController.signal,
  };
  const { signal } = abortController;

  try {
    return await withStagingCleanup(
      artifacts,
      async () => {
        let completedCount = 0;
        const settled = await Promise.allSettled(
          options.jobs.map(async (job, index) =>
            sharedConversionJobLimiter.run(async () => {
              batchRuntime.signal.throwIfAborted();
              try {
                const output = await options.stage(job, index, runId, batchRuntime);
                completedCount += 1;
                options.runtime?.reportProgress?.(completedCount, options.jobs.length);
                return output;
              } catch (error) {
                const stageError = error instanceof Error ? error : new Error(String(error));
                abortController.abort(stageError);
                throw stageError;
              }
            }, batchRuntime.signal),
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
    runtime.signal?.removeEventListener('abort', abortFromCaller);
  }
}
