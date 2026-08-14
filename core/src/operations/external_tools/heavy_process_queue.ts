import PQueue from 'p-queue';

import { OperationCancelledError } from '../../shared/error.js';

/**
 * Single extension-wide queue for work that can consume substantial CPU or
 * memory (conversion batch stages). Cancellation is expressed with standard
 * AbortSignals: a waiting task is removed from the queue and rejected when
 * its signal aborts, while a running task keeps running until it observes the
 * signal itself. Extension shutdown aborts the queue's own controller.
 */
export const heavyProcessQueue = new PQueue({ concurrency: 2 });

const shutdownController = new AbortController();

export function shutdownHeavyProcessQueue(): void {
  shutdownController.abort();
}

export function setHeavyProcessConcurrency(concurrency: number): void {
  heavyProcessQueue.concurrency = concurrency;
}

export async function runHeavyProcess<Value>(task: () => Promise<Value> | Value, signal?: AbortSignal): Promise<Value> {
  return enqueueHeavyProcess(heavyProcessQueue, shutdownController.signal, task, signal);
}

/**
 * Core of {@link runHeavyProcess}, injectable for tests.
 *
 * p-queue rejects the promise of a task that is still queued when its signal
 * aborts, and once a task is running it races the task against the abort
 * reason and rejects immediately. GW's contract is different: a queued task
 * is cancelled at abort, while a running task settles by itself (it observes
 * the signal). Tracking the real task lets callers wait for the running
 * task's own outcome instead of the abort reason, which is what makes the
 * first stage failure deterministic across sibling stages.
 */
export async function enqueueHeavyProcess<Value>(
  queue: PQueue,
  shutdownSignal: AbortSignal,
  task: () => Promise<Value> | Value,
  signal?: AbortSignal,
): Promise<Value> {
  if (shutdownSignal.aborted) {
    throw new OperationCancelledError('Heavy process queue was stopped.');
  }
  if (signal?.aborted === true) {
    throw new OperationCancelledError('Heavy process was cancelled before it started.');
  }
  const combinedSignal = signal === undefined ? shutdownSignal : AbortSignal.any([signal, shutdownSignal]);

  let startedTask: Promise<Value> | undefined;

  const queuedResult = queue.add(
    async (): Promise<Value> => {
      const taskResult = (async () => task())();
      startedTask = taskResult;
      return taskResult;
    },
    { signal: combinedSignal },
  );

  try {
    return await queuedResult;
  } catch (error) {
    const runningTask = startedTask;
    if (runningTask === undefined) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    // The signal aborted while the task was running: p-queue's rejection
    // carries the abort reason, not the task outcome. Await the task's own
    // settlement, which observes the signal internally.
    return await runningTask;
  }
}
