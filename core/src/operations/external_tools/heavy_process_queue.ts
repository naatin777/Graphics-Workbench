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
  if (shutdownController.signal.aborted) {
    throw new OperationCancelledError('Heavy process queue was stopped.');
  }
  if (signal?.aborted === true) {
    throw new OperationCancelledError('Heavy process was cancelled before it started.');
  }
  const combinedSignal =
    signal === undefined ? shutdownController.signal : AbortSignal.any([signal, shutdownController.signal]);
  return heavyProcessQueue.add(task, { signal: combinedSignal });
}
