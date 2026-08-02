import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

import type { LineOutputChannel } from './external_tool_ascii_scratch.js';

const MAX_BUFFER = 10 * 1024 * 1024;
const TERMINATION_GRACE_MS = 250;
const DEFAULT_TIMEOUTS_MS: Readonly<Record<string, number>> = {
  qpdf: 120_000,
  drawio: 300_000,
  Ghostscript: 300_000,
  pdftocairo: 120_000,
  'rsvg-convert': 120_000,
};

export interface ExternalToolResult {
  stdout: string;
  stderr: string;
}

/** Runs a tool with cancellation, a bounded wait, and process-tree cleanup. */
export async function runExternalTool(options: {
  toolName: string;
  executable: string;
  args: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  outputChannel?: LineOutputChannel;
  redactArgument?: (argument: string, index: number) => string;
}): Promise<ExternalToolResult> {
  const loggedArgs = options.args.map((argument, index) => options.redactArgument?.(argument, index) ?? argument);
  options.outputChannel?.appendLine(`[${options.toolName}] executable: ${options.executable}`);
  options.outputChannel?.appendLine(`[${options.toolName}] arguments: ${loggedArgs.join(' ')}`);

  if (options.signal?.aborted === true) {
    throw createAbortError();
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUTS_MS[options.toolName];

  return new Promise<ExternalToolResult>((resolve, reject) => {
    // The abort callback is declared before spawn so it can handle a signal during startup.
    // oxlint-disable-next-line prefer-const
    let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
    let timer: NodeJS.Timeout | undefined;
    let terminationReason: Error | undefined;
    let settled = false;
    let stdout = '';
    let stderr = '';

    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', abort);
    };

    const finishFailure = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      options.outputChannel?.appendLine(`[${options.toolName}] failure: ${stderr.trim() || error.message}`);
      reject(error);
    };

    const abort = (): void => {
      if (settled) {
        return;
      }
      terminationReason = createAbortError();
      if (child !== undefined) {
        terminateProcessTree(child);
      }
    };

    const runningChild = (child = spawn(options.executable, options.args, {
      detached: process.platform !== 'win32',
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    runningChild.stdout.setEncoding('utf8');
    runningChild.stderr.setEncoding('utf8');
    runningChild.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_BUFFER && terminationReason === undefined) {
        terminationReason = new Error(`${options.toolName} exceeded the ${MAX_BUFFER} byte output limit`);
        terminateProcessTree(runningChild);
      }
    });
    runningChild.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    runningChild.on('error', (error) => {
      finishFailure(terminationReason ?? error);
    });
    runningChild.on('close', (code, signal) => {
      if (terminationReason !== undefined) {
        finishFailure(terminationReason);
        return;
      }
      if (code !== 0) {
        finishFailure(
          new Error(`${options.toolName} failed (exited with code ${code ?? 'unknown'}, signal ${signal ?? 'none'})`),
        );
        return;
      }
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ stdout, stderr });
      }
    });

    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted === true) {
      abort();
    }
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        terminationReason = new Error(`${options.toolName} timed out after ${timeoutMs}ms`);
        terminateProcessTree(child);
      }, timeoutMs);
    }
  });
}

function createAbortError(): Error {
  const error = new Error('External tool execution was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function terminateProcessTree(child: ChildProcess | undefined): void {
  const pid = child?.pid;
  if (child === undefined || pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        const taskkill = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        taskkill.unref();
      }
    }, TERMINATION_GRACE_MS);
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }, TERMINATION_GRACE_MS);
}
