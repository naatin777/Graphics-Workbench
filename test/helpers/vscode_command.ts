import { setTimeout as delay } from 'node:timers/promises';

import * as vscode from 'vscode';

const NOTIFICATION_CLEAR_INTERVAL_MS = 500;

export async function runCommandAndClearNotificationsUntilDone<T>(commandExecution: Thenable<T>): Promise<T> {
  const commandPromise = Promise.resolve(commandExecution);
  const completion = waitForCompletion(commandPromise);
  const stopClearing = new AbortController();

  try {
    while (true) {
      const clearing = clearAfterDelay(stopClearing.signal);
      const result = await Promise.race([completion, clearing]);
      if (result === 'done') {
        stopClearing.abort();
        await clearing;
        break;
      }
    }

    return await commandPromise;
  } finally {
    // Promise.race does not cancel its losing delay. Stop it so a completed
    // command cannot dismiss a later command's cancellable progress UI.
    stopClearing.abort();
  }
}

async function waitForCompletion(promise: Promise<unknown>): Promise<'done'> {
  try {
    await promise;
  } catch {
    // The caller awaits commandPromise and observes the original rejection.
  }

  return 'done';
}

async function clearAfterDelay(signal: AbortSignal): Promise<'continue' | 'stopped'> {
  try {
    await delay(NOTIFICATION_CLEAR_INTERVAL_MS, undefined, { signal });
  } catch (error) {
    if (signal.aborted) {
      return 'stopped';
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(String(error), { cause: error });
  }

  if (signal.aborted) {
    return 'stopped';
  }

  await vscode.commands.executeCommand('notifications.clearAll');
  return 'continue';
}
