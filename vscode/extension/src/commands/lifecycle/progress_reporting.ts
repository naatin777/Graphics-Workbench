import type * as vscode from 'vscode';

import { userMessage } from '../shared/user_messages.js';

export interface ConversionProgressReporters {
  reportProgress: (completed: number, total: number) => void;
  reportMessage: (message: string) => void;
}

/**
 * Wires input progress into a determinate VS Code progress bar.
 *
 * Each completed item advances the bar by an equal share of the total, so the
 * bar reflects how many input steps have finished. Progress reporters
 * that cannot measure total steps simply report messages (indeterminate).
 */
export function createProgressReporters(
  progress: vscode.Progress<{ message?: string; increment?: number }>,
): ConversionProgressReporters {
  return {
    reportProgress: (completed, total) => {
      const message = userMessage('message.progress.completedCount', completed, total);
      progress.report(total > 0 ? { message, increment: 100 / total } : { message });
    },
    reportMessage: (message) => {
      progress.report({ message });
    },
  };
}
