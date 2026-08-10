import type { OutputConflictDecision } from './commit_conversion_outputs.js';
import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';

type ConflictResolver = (conflicts: string[]) => Promise<OutputConflictDecision>;
type ProgressReporter = (completed: number, total: number) => void;
type MessageReporter = (message: string) => void;

/** Dependencies shared by one input run, not by an individual source input. */
export interface ConversionExecutionContext {
  signal?: AbortSignal;
  outputChannel?: LineOutputChannel;
  resolveConflicts?: ConflictResolver;
  reportProgress?: ProgressReporter;
  reportMessage?: MessageReporter;
}

/**
 * `ConversionExecutionContext` with a guaranteed `signal`. Staging callbacks and
 * the helpers they call only run while the batch owns an active abort signal, so
 * callers of a resolved runtime can use `runtime.signal` without a guard.
 */
export interface ResolvedConversionRuntime extends ConversionExecutionContext {
  signal: AbortSignal;
}
