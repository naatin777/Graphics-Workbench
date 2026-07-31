import { sourceFormatForPath } from '../../application/policy/source_format.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

export interface AssertPreflightPassedOptions {
  signal?: AbortSignal;
}

/**
 * Keeps the RAW sidecar inside the same trusted workspace boundary as its source.
 *
 * Input readability and format validity are intentionally not checked here. Each
 * decoder or external tool owns those checks while performing the real conversion.
 */
export async function assertPreflightPassed(
  jobs: { sourcePath: string; workspacePath?: string }[],
  options?: AssertPreflightPassedOptions,
): Promise<void> {
  options?.signal?.throwIfAborted();

  await Promise.all(
    jobs.flatMap((job) =>
      sourceFormatForPath(job.sourcePath) === 'raw' && job.workspacePath !== undefined
        ? [assertExistingPathInWorkspace(`${job.sourcePath}.json`, job.workspacePath)]
        : [],
    ),
  );

  options?.signal?.throwIfAborted();
}

export function preflightOptionsFromRuntime(runtime?: ConversionExecutionContext): AssertPreflightPassedOptions {
  return runtime?.signal === undefined ? {} : { signal: runtime.signal };
}
