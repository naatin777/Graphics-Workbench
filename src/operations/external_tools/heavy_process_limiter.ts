import { OperationCancelledError } from '../../shared/error.js';

interface WaitingTask {
  start: () => Promise<void>;
  cancel: () => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

/** A single extension-wide queue for processes that can consume substantial CPU or memory. */
export class HeavyProcessLimiter {
  private concurrency: number;
  private active = 0;
  private stopped = false;
  private readonly queue: WaitingTask[] = [];

  public constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  public setConcurrency(concurrency: number): void {
    this.concurrency = concurrency;
    this.drain();
  }

  public stop(): void {
    this.stopped = true;
    const queued = this.queue.splice(0);
    for (const task of queued) {
      if (task.onAbort !== undefined) {
        task.signal?.removeEventListener('abort', task.onAbort);
      }
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
      let queued = true;
      const waiting: WaitingTask = {
        signal,
        onAbort: undefined,
        cancel: () => {
          if (!queued) {
            return;
          }
          queued = false;
          reject(new OperationCancelledError('Heavy process was cancelled before it started.'));
        },
        start: async (): Promise<void> => {
          if (!queued) {
            return;
          }
          queued = false;
          try {
            resolve(await task());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          } finally {
            this.active -= 1;
            this.drain();
          }
        },
      };
      const onAbort = (): void => {
        const index = this.queue.indexOf(waiting);
        if (index < 0) {
          return;
        }
        this.queue.splice(index, 1);
        signal?.removeEventListener('abort', onAbort);
        waiting.cancel();
      };
      waiting.onAbort = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiting);
      this.drain();
    });
  }

  private drain(): void {
    while (!this.stopped && this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task === undefined) {
        return;
      }
      if (task.onAbort !== undefined) {
        task.signal?.removeEventListener('abort', task.onAbort);
      }
      if (task.signal?.aborted === true) {
        task.cancel();
        continue;
      }
      this.active += 1;
      void task.start();
    }
  }
}

export const sharedHeavyProcessLimiter = new HeavyProcessLimiter(2);
/** Shared conversion-stage queue retained for staged-batch cancellation semantics. */
export const sharedConversionJobLimiter = new HeavyProcessLimiter(2);
