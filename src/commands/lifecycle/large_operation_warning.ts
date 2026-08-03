import { stat } from 'node:fs/promises';

import * as vscode from 'vscode';

import {
  getLargeOperationWarningReasons,
  getLargeOperationWarningSettings,
} from '../../config/large_operation_warnings.js';
import { OperationCancelledError } from '../../operations/lifecycle/operation_cancelled_error.js';
import { userMessage } from '../shared/user_messages.js';

export async function confirmLargeOperation(options: {
  sourcePaths: readonly string[];
  pdfPageCount?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const settings = getLargeOperationWarningSettings();
  if (!settings.enabled) {
    return;
  }

  options.signal?.throwIfAborted();
  const totalBytes = await readTotalInputBytes(options.sourcePaths);
  const reasons = getLargeOperationWarningReasons(settings, {
    totalBytes,
    ...(options.pdfPageCount === undefined ? {} : { pdfPageCount: options.pdfPageCount }),
  });
  if (reasons.pdfPageCount === undefined && reasons.inputSizeMiB === undefined) {
    return;
  }

  const reasonMessages: string[] = [];
  if (reasons.pdfPageCount !== undefined) {
    reasonMessages.push(userMessage('message.largeOperationWarning.pages', reasons.pdfPageCount));
  }
  if (reasons.inputSizeMiB !== undefined) {
    reasonMessages.push(userMessage('message.largeOperationWarning.size', reasons.inputSizeMiB));
  }
  const continueAction = userMessage('message.largeOperationWarning.continue');
  const cancelAction = userMessage('message.largeOperationWarning.cancel');
  const selectedAction = await vscode.window.showWarningMessage(
    userMessage('message.largeOperationWarning', reasonMessages.join('、')),
    { modal: true },
    continueAction,
    cancelAction,
  );
  options.signal?.throwIfAborted();
  if (selectedAction !== continueAction) {
    throw new OperationCancelledError('The large operation was cancelled before output staging.');
  }
}

async function readTotalInputBytes(sourcePaths: readonly string[]): Promise<number> {
  const sizes = await Promise.all(
    sourcePaths.map(async (sourcePath) => {
      try {
        const fileStat = await stat(sourcePath);
        return fileStat.isFile() ? fileStat.size : 0;
      } catch {
        return 0;
      }
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}
