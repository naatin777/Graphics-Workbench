import type { ConversionExecutionContext, OutputConflictDecision } from '@graphics-workbench/core/runtime';

import { RecordingOutputChannel } from './output_channel.js';

export interface TestRuntime {
  runtime: ConversionExecutionContext;
  messages: string[];
  progress: { completed: number; total: number }[];
  output: RecordingOutputChannel;
  abort(): void;
}

export interface CreateTestRuntimeOptions {
  conflictDecision?: OutputConflictDecision;
}

export function createTestRuntime(options: CreateTestRuntimeOptions = {}): TestRuntime {
  const controller = new AbortController();
  const output = new RecordingOutputChannel();
  const messages: string[] = [];
  const progress: { completed: number; total: number }[] = [];
  const conflictDecision = options.conflictDecision ?? 'overwrite';
  return {
    runtime: {
      signal: controller.signal,
      outputChannel: output,
      resolveConflicts: async () => conflictDecision,
      reportProgress: (completed, total) => {
        progress.push({ completed, total });
      },
      reportMessage: (message) => {
        messages.push(message);
      },
    },
    messages,
    progress,
    output,
    abort: () => {
      controller.abort();
    },
  };
}
