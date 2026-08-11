import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OperationCancelledError } from '@graphics-workbench/core/shared/error.js';
import type { LineOutputChannel } from '@graphics-workbench/core/operations/external_tools/external_tool_ascii_scratch.js';
import { terminateProcessTree } from '@graphics-workbench/core/operations/external_tools/run_external_tool.js';
import type { CropPdfFileRequest } from './crop_pdf_core.js';
import {
  createCropPdfProcessRequest,
  isCropPdfProcessMessage,
  type CropPdfProcessRequest,
} from './crop_pdf_process_protocol.js';

const TERMINATION_WATCHDOG_MS = 5_000;
const COMPLETION_GRACE_MS = 5_000;

export interface CropProcessChild extends EventEmitter {
  readonly pid: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  send: (message: CropPdfProcessRequest, callback?: (error: Error | null) => void) => boolean;
  terminate: () => void;
  dispose: () => void;
}

export interface RunCropPdfProcessOptions {
  outputChannel?: LineOutputChannel;
  requestId?: string;
  runnerPath?: string;
  launcher?: (runnerPath: string) => CropProcessChild;
  terminate?: (child: CropProcessChild) => void;
  terminationWatchdogMs?: number;
  completionGraceMs?: number;
}

/** Runs crop processing outside the Extension Host so cancellation can kill the whole process tree. */
export async function runCropPdfProcess(
  request: CropPdfFileRequest,
  signal?: AbortSignal,
  options: RunCropPdfProcessOptions = {},
): Promise<void> {
  const requestId = options.requestId ?? randomUUID();
  const { outputChannel } = options;
  const log = (event: string, details = ''): void => {
    const suffix = details === '' ? '' : ` ${details}`;
    outputChannel?.appendLine(`[crop-process] ${event} requestId=${requestId}${suffix}`);
  };

  if (signal?.aborted === true) {
    log('operation-cancelled-before-start');
    throw new OperationCancelledError('Crop processing was cancelled.');
  }

  const runnerPath =
    options.runnerPath ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'crop_pdf_runner.js');
  const launcher = options.launcher ?? defaultLauncher;
  const terminate = options.terminate ?? defaultTerminate;
  const watchdogMs = options.terminationWatchdogMs ?? TERMINATION_WATCHDOG_MS;
  const completionGraceMs = options.completionGraceMs ?? COMPLETION_GRACE_MS;
  const processRequest = createCropPdfProcessRequest(request, requestId);

  log('operation-started');

  await new Promise<void>((resolve, reject) => {
    let child: CropProcessChild;
    try {
      child = launcher(runnerPath);
    } catch (error) {
      const normalized = asError(error);
      log('child-spawn-failed', `error=${formatLogValue(normalized.message)}`);
      reject(normalized);
      return;
    }

    let settled = false;
    let started = false;
    let successReceived = false;
    let failure: Error | undefined;
    let failureReceivedFromChild = false;
    let disconnected = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let terminationReason: Error | undefined;
    let terminationWatchdog: NodeJS.Timeout | undefined;
    let completionGraceTimer: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
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
      settled = true;
      cleanup();
      if (error === undefined) {
        log('process-completed');
        resolve();
      } else {
        log(
          isCancellationError(error) ? 'operation-cancelled' : 'operation-failed',
          `error=${failureReceivedFromChild ? 'child-failure' : formatLogValue(error.message)}`,
        );
        reject(error);
      }
    };

    const requestTermination = (reason: Error): void => {
      if (settled) {
        return;
      }

      terminationReason ??= reason;
      if (terminationWatchdog === undefined) {
        log('process-termination-requested', `reason=${formatLogValue(terminationReason.message)}`);
        terminationWatchdog = setTimeout(() => {
          finish(terminationReason ?? new Error('Crop runner did not terminate.'));
        }, watchdogMs);
        try {
          terminate(child);
        } catch (error) {
          log('process-termination-failed', `error=${formatLogValue(asError(error).message)}`);
        }
      }
    };

    const requestCompletionTermination = (): void => {
      if (settled || exited || terminationReason !== undefined || completionGraceTimer !== undefined) {
        return;
      }

      completionGraceTimer = setTimeout(() => {
        const reason = successReceived
          ? new Error('Crop runner did not exit after success.')
          : (failure ?? new Error('Crop runner did not exit after completion or disconnect.'));
        requestTermination(reason);
      }, completionGraceMs);
    };

    const abort = (): void => {
      if (settled) {
        return;
      }
      log('cancellation-requested');
      requestTermination(new OperationCancelledError('Crop processing was cancelled.'));
    };

    const protocolFailure = (message: string): void => {
      const error = new Error(`Crop runner protocol error: ${message}`);
      log('protocol-error', `reason=${formatLogValue(message)}`);
      requestTermination(error);
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
            `Crop runner exited with code ${exitCode ?? 'unknown'} (signal ${exitSignal ?? 'none'}) before success.`,
          ),
        );
        return;
      }

      if (!disconnected) {
        finish(new Error('Crop runner exited before disconnecting after success.'));
        return;
      }

      if (exitCode !== 0) {
        finish(
          new Error(
            `Crop runner reported success but exited with code ${exitCode ?? 'unknown'} (signal ${exitSignal ?? 'none'}).`,
          ),
        );
        return;
      }

      finish();
    };

    // oxlint-disable-next-line typescript/no-restricted-types -- 子プロセスIPC境界の未検証メッセージ。
    const onMessage = (message: unknown): void => {
      if (!isCropPdfProcessMessage(message)) {
        protocolFailure('invalid message');
        return;
      }
      if (message.requestId !== requestId) {
        protocolFailure('request ID mismatch');
        return;
      }

      if (message.type === 'started') {
        if (started || successReceived || failure !== undefined) {
          protocolFailure('duplicate or late started message');
          return;
        }
        started = true;
        log('child-started');
        return;
      }

      if (!started) {
        protocolFailure(`${message.type} message before started`);
        return;
      }

      if (message.type === 'success') {
        if (successReceived || failure !== undefined) {
          protocolFailure('duplicate or conflicting completion message');
          return;
        }
        successReceived = true;
        log('child-success-received');
        requestCompletionTermination();
        canComplete();
        return;
      }

      if (successReceived || failure !== undefined) {
        protocolFailure('duplicate or conflicting failure message');
        return;
      }
      failure = new Error(message.error);
      failureReceivedFromChild = true;
      log('child-failure-received');
      requestCompletionTermination();
      canComplete();
    };

    const onError = (error: Error): void => {
      log('child-error', `error=${formatLogValue(error.message)}`);
      requestTermination(terminationReason ?? error);
    };

    const onDisconnect = (): void => {
      disconnected = true;
      log('child-disconnected');
      requestCompletionTermination();
      canComplete();
    };

    const onExit = (code: number | null, childSignal: NodeJS.Signals | null): void => {
      exited = true;
      exitCode = code;
      exitSignal = childSignal;
      log('child-exited', `code=${code ?? 'unknown'} signal=${childSignal ?? 'none'}`);
      if (terminationReason !== undefined) {
        finish(terminationReason);
        return;
      }
      canComplete();
    };

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('disconnect', onDisconnect);
    child.on('exit', onExit);
    signal?.addEventListener('abort', abort, { once: true });

    log('child-spawned');
    if (signal?.aborted === true) {
      abort();
      return;
    }

    log('request-sent');
    try {
      child.send(processRequest, (error) => {
        if (error !== null) {
          log('request-send-failed', `error=${formatLogValue(error.message)}`);
          requestTermination(isCancellationError(error) ? new OperationCancelledError() : error);
        }
      });
    } catch (error) {
      log('request-send-failed', `error=${formatLogValue(asError(error).message)}`);
      requestTermination(asError(error));
    }
  });
}

function defaultLauncher(runnerPath: string): CropProcessChild {
  return createCropProcessChild(
    fork(runnerPath, [], {
      detached: process.platform !== 'win32',
      execArgv: withoutInlineScriptArgs(process.execArgv),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    }),
  );
}

export function createCropProcessChild(child: ChildProcess): CropProcessChild {
  return new NodeCropProcessChild(child);
}

class NodeCropProcessChild extends EventEmitter implements CropProcessChild {
  // oxlint-disable-next-line typescript/no-restricted-types -- 子プロセスIPC境界の未検証メッセージ。
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

  get pid(): number | undefined {
    return this.child.pid;
  }

  get exitCode(): number | null {
    return this.child.exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.child.signalCode;
  }

  send(message: CropPdfProcessRequest, callback?: (error: Error | null) => void): boolean {
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

function defaultTerminate(child: CropProcessChild): void {
  child.terminate();
}

// oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isCancellationError(error: Error): boolean {
  return error instanceof OperationCancelledError || error.name === 'AbortError';
}

function formatLogValue(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').slice(0, 500);
}

function withoutInlineScriptArgs(execArgv: readonly string[]): string[] {
  return execArgv.filter((argument, index) => {
    const previous = execArgv[index - 1];
    return (
      argument !== '--input-type=module' &&
      argument !== '-e' &&
      argument !== '--eval' &&
      previous !== '-e' &&
      previous !== '--eval'
    );
  });
}
