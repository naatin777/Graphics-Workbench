import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OperationCancelledError } from '../../lifecycle/operation_cancelled_error.js';
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

// ponytail: fixed render ceiling. Mermaid CLI launches a browser that can hang on malformed input.
const MERMAID_RENDER_TIMEOUT_MS = 120_000;

/** Runs Mermaid CLI in a child process so abort and timeouts can terminate the browser. */
export async function runMermaidCliWithSignal(
  request: MermaidCliRunRequest,
  signal?: AbortSignal,
  timeoutMs: number = MERMAID_RENDER_TIMEOUT_MS,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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

    const timer = setTimeout(() => {
      terminateProcessTree(child);
      finish(new Error(`Mermaid CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      if (error !== undefined && signal?.aborted === true) {
        error = new OperationCancelledError('Mermaid rendering was cancelled.');
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };

    const abort = (): void => {
      terminateProcessTree(child);
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
      if (signal?.aborted === true) {
        finish(new OperationCancelledError('Mermaid rendering was cancelled.'));
        return;
      }
      finish(new Error(`Mermaid CLI exited with code ${code ?? 'unknown'} (signal ${childSignal ?? 'none'})`));
    });

    child.send(request);
  });
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
