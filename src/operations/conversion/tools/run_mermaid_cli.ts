import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OperationCancelledError } from '../../lifecycle/operation_cancelled_error.js';
import { getExternalToolTimeoutMs } from '../../../config/external_tools/external_tool_settings.js';
import { sharedHeavyProcessLimiter } from '../../external_tools/heavy_process_limiter.js';
import { terminateProcessTree } from '../../external_tools/run_external_tool.js';
import { type MermaidOutputFormat, isMermaidRunnerFailure, isMermaidRunnerSuccess } from './mermaid_runner_protocol.js';

export interface MermaidCliRunRequest {
  sourcePath: string;
  outputPath: string;
  outputFormat: MermaidOutputFormat;
  puppeteerConfig: Record<string, unknown>;
  backgroundColor?: string;
  theme?: string;
}

interface MermaidCliChild extends EventEmitter {
  send(message: MermaidCliRunRequest, callback?: (error: Error | null) => void): boolean;
  terminate: () => void;
  dispose: () => void;
}

export interface RunMermaidCliOptions {
  timeoutMs?: number;
  terminationWatchdogMs?: number;
  completionGraceMs?: number;
  launcher?: (runnerPath: string) => MermaidCliChild;
}

const CHILD_TERMINATION_WATCHDOG_MS = 5_000;

/** Runs Mermaid CLI in a child process so abort and timeouts can terminate the browser. */
export async function runMermaidCliWithSignal(
  request: MermaidCliRunRequest,
  signal?: AbortSignal,
  options: RunMermaidCliOptions = {},
): Promise<void> {
  const effectiveTimeoutMs =
    options.timeoutMs === 0 ? undefined : (options.timeoutMs ?? getExternalToolTimeoutMs('mermaid'));

  await sharedHeavyProcessLimiter.run(
    async () =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new OperationCancelledError('Mermaid rendering was cancelled.'));
          return;
        }

        const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mermaid_runner.js');
        const launcher =
          options.launcher ??
          ((childRunnerPath: string): MermaidCliChild =>
            createMermaidCliChild(
              fork(childRunnerPath, [], {
                detached: process.platform !== 'win32',
                stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
              }),
            ));
        const watchdogMs = options.terminationWatchdogMs ?? CHILD_TERMINATION_WATCHDOG_MS;
        const completionGraceMs = options.completionGraceMs ?? CHILD_TERMINATION_WATCHDOG_MS;

        let child: MermaidCliChild;
        try {
          child = launcher(runnerPath);
        } catch (error) {
          reject(asError(error));
          return;
        }

        let settled = false;
        let successReceived = false;
        let failure: Error | undefined;
        let disconnected = false;
        let exited = false;
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;
        let terminationReason: Error | undefined;
        let terminationWatchdog: NodeJS.Timeout | undefined;
        let completionGraceTimer: NodeJS.Timeout | undefined;

        const cleanup = (): void => {
          clearTimeout(timer);
          if (terminationWatchdog !== undefined) {
            clearTimeout(terminationWatchdog);
          }
          if (completionGraceTimer !== undefined) {
            clearTimeout(completionGraceTimer);
          }
          signal?.removeEventListener('abort', abort);
          child.removeListener('message', onMessage);
          child.removeListener('error', onError);
          child.removeListener('disconnect', onDisconnect);
          child.removeListener('exit', onExit);
          child.dispose();
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
          try {
            child.terminate();
          } catch {
            // The termination watchdog still finishes the promise.
          }
          terminationWatchdog ??= setTimeout(() => {
            finish(terminationReason ?? new Error('Mermaid CLI child did not terminate.'));
          }, watchdogMs);
        };

        const requestCompletionTermination = (): void => {
          if (settled || exited || terminationReason !== undefined || completionGraceTimer !== undefined) {
            return;
          }

          completionGraceTimer = setTimeout(() => {
            const reason = successReceived
              ? new Error('Mermaid CLI did not exit after success.')
              : (failure ?? new Error('Mermaid CLI did not exit after completion or disconnect.'));
            requestTermination(reason);
          }, completionGraceMs);
        };

        const canComplete = (): void => {
          if (!exited || terminationReason !== undefined) {
            return;
          }

          if (failure !== undefined) {
            finish(failure);
            return;
          }

          if (!successReceived) {
            finish(
              new Error(
                `Mermaid CLI exited with code ${exitCode ?? 'unknown'} (signal ${exitSignal ?? 'none'}) before success.`,
              ),
            );
            return;
          }

          if (!disconnected) {
            finish(new Error('Mermaid CLI exited before disconnecting after success.'));
            return;
          }

          if (exitCode !== 0) {
            finish(
              new Error(
                `Mermaid CLI reported success but exited with code ${exitCode ?? 'unknown'} (signal ${exitSignal ?? 'none'}).`,
              ),
            );
            return;
          }

          finish();
        };

        const onMessage = (message: unknown): void => {
          if (isMermaidRunnerSuccess(message)) {
            if (successReceived || failure !== undefined) {
              finish(new Error('Mermaid CLI sent a duplicate or conflicting completion message.'));
              return;
            }
            successReceived = true;
            requestCompletionTermination();
            canComplete();
          } else if (isMermaidRunnerFailure(message)) {
            if (successReceived || failure !== undefined) {
              finish(new Error('Mermaid CLI sent a duplicate or conflicting completion message.'));
              return;
            }
            failure = new Error(message.error);
            requestCompletionTermination();
            canComplete();
          }
        };

        const onError = (error: Error): void => {
          finish(error);
        };

        const onDisconnect = (): void => {
          disconnected = true;
          requestCompletionTermination();
          canComplete();
        };

        const onExit = (code: number | null, childSignal: NodeJS.Signals | null): void => {
          exited = true;
          exitCode = code;
          exitSignal = childSignal;
          if (terminationReason !== undefined) {
            finish(terminationReason);
            return;
          }
          canComplete();
        };

        const abort = (): void => {
          requestTermination(new OperationCancelledError('Mermaid rendering was cancelled.'));
        };

        const timer =
          effectiveTimeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                requestTermination(new Error(`Mermaid CLI timed out after ${effectiveTimeoutMs}ms`));
              }, effectiveTimeoutMs);

        signal?.addEventListener('abort', abort, { once: true });

        child.on('message', onMessage);
        child.on('error', onError);
        child.on('disconnect', onDisconnect);
        child.on('exit', onExit);

        try {
          child.send(request, (error) => {
            if (error !== null) {
              requestTermination(asError(error));
            }
          });
        } catch (error) {
          requestTermination(asError(error));
        }
      }),
    signal,
  );
}

function createMermaidCliChild(child: ChildProcess): MermaidCliChild {
  return new NodeMermaidCliChild(child);
}

class NodeMermaidCliChild extends EventEmitter implements MermaidCliChild {
  private readonly onMessage = (message: unknown): void => {
    this.emit('message', message);
  };
  private readonly onError = (error: Error): void => {
    this.emit('error', error);
  };
  private readonly onDisconnect = (): void => {
    this.emit('disconnect');
  };
  private readonly onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    this.emit('exit', code, signal);
  };

  constructor(private readonly child: ChildProcess) {
    super();
    child.on('message', this.onMessage);
    child.on('error', this.onError);
    child.on('disconnect', this.onDisconnect);
    child.on('exit', this.onExit);
  }

  send(message: MermaidCliRunRequest, callback?: (error: Error | null) => void): boolean {
    return this.child.send(message, callback);
  }

  terminate(): void {
    terminateProcessTree(this.child);
  }

  dispose(): void {
    this.child.removeListener('message', this.onMessage);
    this.child.removeListener('error', this.onError);
    this.child.removeListener('disconnect', this.onDisconnect);
    this.child.removeListener('exit', this.onExit);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
