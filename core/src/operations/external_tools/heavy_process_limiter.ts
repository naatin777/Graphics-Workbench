import pLimit from 'p-limit';

import { OperationCancelledError } from '../../shared/error.js';

interface PendingTask {
  cancel: () => void;
}

/** A single extension-wide queue for processes that can consume substantial CPU or memory. */
export class HeavyProcessLimiter {
  private readonly limiter: ReturnType<typeof pLimit>;
  private stopped = false;
  private readonly pending = new Set<PendingTask>();

  public constructor(concurrency: number) {
    this.limiter = pLimit(concurrency);
  }

  public setConcurrency(concurrency: number): void {
    this.limiter.concurrency = concurrency;
  }

  public stop(): void {
    this.stopped = true;
    this.limiter.clearQueue();
    for (const task of this.pending) {
      task.cancel();
    }
  }

  public async run<Value>(task: () => Promise<Value>, signal?: AbortSignal): Promise<Value> {
    if (this.stopped) {
      throw new OperationCancelledError('Heavy process queue was stopped.');
    }
    if (signal?.aborted === true) {
      throw new OperationCancelledError('Heavy process was cancelled before it started.');
    }

    return new Promise<Value>((resolve, reject) => {
      let started = false;
      let cancelled = false;
      const onAbort = (): void => {
        if (started) {
          return;
        }
        waiting.cancel();
      };

      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort);
      };

      const waiting: PendingTask = {
        cancel: () => {
          if (started || cancelled) {
            return;
          }
          cancelled = true;
          this.pending.delete(waiting);
          cleanup();
          reject(new OperationCancelledError('Heavy process was cancelled before it started.'));
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.add(waiting);

      void this.limiter(async () => {
        if (cancelled || signal?.aborted === true) {
          waiting.cancel();
          return;
        }

        started = true;
        this.pending.delete(waiting);
        cleanup();
        try {
          resolve(await task());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}

export const sharedHeavyProcessLimiter = new HeavyProcessLimiter(2);
/** Shared input-stage queue retained for staged-batch cancellation semantics. */
export const sharedConversionJobLimiter = new HeavyProcessLimiter(2);
