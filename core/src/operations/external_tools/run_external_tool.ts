import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

import { getExternalToolTimeoutMs, type ExternalToolId } from '../../config/external_tools/external_tool_settings.js';
import { sharedHeavyProcessLimiter } from './heavy_process_limiter.js';
import type { LineOutputChannel } from './external_tool_ascii_scratch.js';

// Only the trailing portion of captured stdout/stderr is retained in memory.
// Overflowing this bound does not terminate the tool; verbose diagnostics are
// intentionally dropped rather than accumulated without limit.
const MAX_RETAINED_OUTPUT = 256 * 1024;

// The tail is kept as raw bytes and decoded once at read time so that the
// trim stays on byte boundaries. A multi-byte UTF-8 sequence cut at the trim
// boundary decodes as U+FFFD, which is acceptable for diagnostics.
type OutputAccumulator = { buffers: Buffer[]; bytes: number };

const createOutputAccumulator = (): OutputAccumulator => ({ buffers: [], bytes: 0 });

const appendBounded = (accumulator: OutputAccumulator, chunk: Buffer): void => {
  accumulator.buffers.push(chunk);
  accumulator.bytes += chunk.byteLength;
  while (accumulator.bytes > MAX_RETAINED_OUTPUT) {
    const head = accumulator.buffers.shift();
    if (head === undefined) {
      break;
    }
    const excess = accumulator.bytes - MAX_RETAINED_OUTPUT;
    if (head.byteLength <= excess) {
      accumulator.bytes -= head.byteLength;
      continue;
    }
    accumulator.buffers.unshift(head.subarray(excess));
    accumulator.bytes -= excess;
    break;
  }
};

const decodeOutput = (accumulator: OutputAccumulator): string => Buffer.concat(accumulator.buffers).toString('utf8');

const TERMINATION_GRACE_MS = 250;
const TERMINATION_WATCHDOG_MS = 5_000;

export interface ExternalToolResult {
  stdout: string;
  stderr: string;
}

interface RunExternalToolOptions {
  /** Stable timeout identity; `toolName` remains the user-facing label. */
  toolId?: ExternalToolId;
  toolName: string;
  executable: string;
  args: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  outputChannel?: LineOutputChannel;
  redactArgument?: (argument: string, index: number) => string;
}

/** Runs a tool with cancellation, a bounded wait, and process-tree cleanup. */
export async function runExternalTool(options: RunExternalToolOptions): Promise<ExternalToolResult> {
  const loggedArgs = options.args.map((argument, index) => options.redactArgument?.(argument, index) ?? argument);
  options.outputChannel?.appendLine(`[${options.toolName}] executable: ${options.executable}`);
  options.outputChannel?.appendLine(`[${options.toolName}] arguments: ${loggedArgs.join(' ')}`);

  if (options.signal?.aborted === true) {
    throw createAbortError();
  }

  const timeoutMs =
    options.timeoutMs === 0
      ? undefined
      : (options.timeoutMs ?? (options.toolId === undefined ? undefined : getExternalToolTimeoutMs(options.toolId)));

  return sharedHeavyProcessLimiter.run(
    async () =>
      new Promise<ExternalToolResult>((resolve, reject) => {
        // The abort callback is declared before spawn so it can handle a signal during startup.
        // oxlint-disable-next-line prefer-const
        let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
        let timer: NodeJS.Timeout | undefined;
        let terminationWatchdog: NodeJS.Timeout | undefined;
        let terminationReason: Error | undefined;
        let settled = false;

        const stdoutAccumulator = createOutputAccumulator();
        const stderrAccumulator = createOutputAccumulator();

        const cleanup = (): void => {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          if (terminationWatchdog !== undefined) {
            clearTimeout(terminationWatchdog);
          }
          options.signal?.removeEventListener('abort', abort);
        };

        const finishFailure = (error: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          options.outputChannel?.appendLine(
            `[${options.toolName}] failure: ${decodeOutput(stderrAccumulator).trim() || error.message}`,
          );
          reject(error);
        };

        const requestTermination = (reason: Error): void => {
          if (settled) {
            return;
          }
          terminationReason ??= reason;
          terminateProcessTree(child);
          terminationWatchdog ??= setTimeout(() => {
            finishFailure(terminationReason ?? new Error(`${options.toolName} did not terminate`));
          }, TERMINATION_WATCHDOG_MS);
        };

        const abort = (): void => {
          if (settled) {
            return;
          }
          requestTermination(createAbortError());
        };

        const runningChild = (child = spawn(options.executable, options.args, {
          detached: process.platform !== 'win32',
          env: options.env ?? process.env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }));
        runningChild.stdout.on('data', (chunk: Buffer) => {
          if (terminationReason !== undefined) {
            return;
          }
          appendBounded(stdoutAccumulator, chunk);
        });
        runningChild.stderr.on('data', (chunk: Buffer) => {
          if (terminationReason !== undefined) {
            return;
          }
          appendBounded(stderrAccumulator, chunk);
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
            const error = Object.assign(
              new Error(
                `${options.toolName} failed (exited with code ${code ?? 'unknown'}, signal ${signal ?? 'none'})`,
              ),
              { stderr: decodeOutput(stderrAccumulator) },
            );
            finishFailure(error);
            return;
          }
          if (!settled) {
            settled = true;
            cleanup();
            resolve({ stdout: decodeOutput(stdoutAccumulator), stderr: decodeOutput(stderrAccumulator) });
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
            requestTermination(new Error(`${options.toolName} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }
      }),
    options.signal,
  );
}

function createAbortError(): Error {
  const error = new Error('External tool execution was cancelled.');
  error.name = 'AbortError';
  return error;
}

// Declared as a structural subset so unit tests can pass a fake child.
export function terminateProcessTree(
  child: Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'> | undefined,
): void {
  const pid = child?.pid;
  if (child === undefined || pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    // taskkill /t /f terminates the whole tree (parent plus descendants) from
    // the start; killing only the parent first lets Draw.io/Chromium children
    // survive when the parent exits before the grace timer elapses. child.kill()
    // remains as a fallback when taskkill cannot run or fails.
    if (child.exitCode === null && child.signalCode === null) {
      const taskkill = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      taskkill.on('error', () => {
        child.kill();
      });
      taskkill.on('exit', (code) => {
        if (code !== 0) {
          child.kill();
        }
      });
      taskkill.unref();
    }
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
