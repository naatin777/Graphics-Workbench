import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

export interface AssertPreflightPassedOptions {
  signal?: AbortSignal;
}

/**
 * Asserts cancellation state before a conversion begins.
 *
 * Input readability and format validity are intentionally not checked here. Each
 * decoder or external tool owns those checks while performing the real conversion.
 */
export async function assertPreflightPassed(options?: AssertPreflightPassedOptions): Promise<void> {
  options?.signal?.throwIfAborted();
}

export function preflightOptionsFromRuntime(runtime?: ConversionExecutionContext): AssertPreflightPassedOptions {
  return runtime?.signal === undefined ? {} : { signal: runtime.signal };
}
