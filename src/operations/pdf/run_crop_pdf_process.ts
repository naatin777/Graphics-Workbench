import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OperationCancelledError } from '../lifecycle/operation_cancelled_error.js';
import { terminateProcessTree } from '../external_tools/run_external_tool.js';
import type { CropPdfFileRequest } from './crop_pdf_core.js';

const TERMINATION_WATCHDOG_MS = 5_000;

interface CropRunnerSuccess {
  ok: true;
}

interface CropRunnerFailure {
  ok: false;
  error: string;
}

/** Runs crop processing outside the Extension Host so cancellation can kill the whole process tree. */
export async function runCropPdfProcess(request: CropPdfFileRequest, signal?: AbortSignal): Promise<void> {
  const operationSignal = signal;
  await new Promise<void>((resolve, reject) => {
    if (isAbortSignalAborted(operationSignal)) {
      reject(new OperationCancelledError('Crop processing was cancelled.'));
      return;
    }

    const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'crop_pdf_runner.js');
    const child = fork(runnerPath, [], {
      detached: process.platform !== 'win32',
      execArgv: withoutInlineScriptArgs(process.execArgv),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let settled = false;
    let terminationWatchdog: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (terminationWatchdog !== undefined) {
        clearTimeout(terminationWatchdog);
      }
      operationSignal?.removeEventListener('abort', abort);
    };

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };

    const terminate = (error: Error): void => {
      if (settled) {
        return;
      }
      terminateProcessTree(child);
      terminationWatchdog ??= setTimeout(() => {
        finish(error);
      }, TERMINATION_WATCHDOG_MS);
    };

    const abort = (): void => {
      terminate(new OperationCancelledError('Crop processing was cancelled.'));
    };

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
      if (!settled) {
        finish(new Error(`Crop runner exited with code ${code ?? 'unknown'} (signal ${childSignal ?? 'none'})`));
      }
    });

    operationSignal?.addEventListener('abort', abort, { once: true });
    if (isAbortSignalAborted(operationSignal)) {
      abort();
      return;
    }

    child.send(request, (error) => {
      if (error !== null) {
        finish(
          isAbortSignalAborted(operationSignal) ? new OperationCancelledError('Crop processing was cancelled.') : error,
        );
      }
    });
  });
}

function isSuccessMessage(value: unknown): value is CropRunnerSuccess {
  return isRecord(value) && value.ok === true;
}

function isFailureMessage(value: unknown): value is CropRunnerFailure {
  return isRecord(value) && value.ok === false && typeof value.error === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
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
