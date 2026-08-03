import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OperationCancelledError } from '../../lifecycle/operation_cancelled_error.js';
import { getExternalToolTimeoutMs } from '../../../config/external_tools/external_tool_settings.js';
import { sharedHeavyProcessLimiter } from '../../external_tools/heavy_process_limiter.js';
import { terminateProcessTree } from '../../external_tools/run_external_tool.js';

type MermaidOutputFormat = 'svg' | 'png' | 'pdf';

export interface MermaidCliRunRequest {
  sourcePath: string;
  outputPath: string;
  outputFormat: MermaidOutputFormat;
  puppeteerConfig: Record<string, unknown>;
  backgroundColor?: string;
  theme?: string;
}

interface MermaidRunnerSuccess {
  ok: true;
}

interface MermaidRunnerFailure {
  ok: false;
  error: string;
}

const CHILD_TERMINATION_WATCHDOG_MS = 5_000;

/** Runs Mermaid CLI in a child process so abort and timeouts can terminate the browser. */
export async function runMermaidCliWithSignal(
  request: MermaidCliRunRequest,
  signal?: AbortSignal,
  timeoutMs?: number,
  terminationWatchdogMs: number = CHILD_TERMINATION_WATCHDOG_MS,
): Promise<void> {
  const effectiveTimeoutMs = timeoutMs === 0 ? undefined : (timeoutMs ?? getExternalToolTimeoutMs('mermaid'));

  await sharedHeavyProcessLimiter.run(
    async () =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new OperationCancelledError('Mermaid rendering was cancelled.'));
          return;
        }

        const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mermaid_runner.js');
        const child = fork(runnerPath, [], {
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        let settled = false;
        let terminationReason: Error | undefined;
        let terminationWatchdog: NodeJS.Timeout | undefined;

        const cleanup = (): void => {
          clearTimeout(timer);
          if (terminationWatchdog !== undefined) {
            clearTimeout(terminationWatchdog);
          }
          signal?.removeEventListener('abort', abort);
        };

        const finish = (error?: Error): void => {
          if (settled) {
            return;
          }
          if (error !== undefined && signal?.aborted === true) {
            error = new OperationCancelledError('Mermaid rendering was cancelled.');
          }
          settled = true;
          cleanup();
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        };

        const requestTermination = (reason: Error): void => {
          if (settled) {
            return;
          }

          terminationReason ??= reason;
          terminateProcessTree(child);
          terminationWatchdog ??= setTimeout(() => {
            finish(terminationReason ?? new Error('Mermaid CLI child did not terminate.'));
          }, terminationWatchdogMs);
        };

        const timer =
          effectiveTimeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                requestTermination(new Error(`Mermaid CLI timed out after ${effectiveTimeoutMs}ms`));
              }, effectiveTimeoutMs);

        const abort = (): void => {
          requestTermination(new OperationCancelledError('Mermaid rendering was cancelled.'));
        };

        signal?.addEventListener('abort', abort, { once: true });

        child.on('message', (message: unknown) => {
          if (isSuccessMessage(message)) {
            finish();
          } else if (isFailureMessage(message)) {
            finish(new Error(message.error));
          }
        });

        child.on('error', (error) => {
          finish(error);
        });

        child.on('exit', (code, childSignal) => {
          if (terminationReason !== undefined) {
            finish(terminationReason);
            return;
          }
          finish(new Error(`Mermaid CLI exited with code ${code ?? 'unknown'} (signal ${childSignal ?? 'none'})`));
        });

        try {
          child.send(request, (error) => {
            if (error !== null) {
              finish(error);
            }
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    signal,
  );
}

function isSuccessMessage(value: unknown): value is MermaidRunnerSuccess {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { ok?: unknown };
  return candidate.ok === true;
}

function isFailureMessage(value: unknown): value is MermaidRunnerFailure {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { ok?: unknown; error?: unknown };
  return candidate.ok === false && typeof candidate.error === 'string';
}
