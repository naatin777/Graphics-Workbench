import * as vscode from 'vscode';

import { inspectPdfSummary } from '../../operations/pdf/run_pdf_summary.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { userMessage } from './user_messages.js';

/** Reads the PDF page count inside a cancellable progress notification. */
export async function readPdfPageCount(sourcePath: string, progressTitle: string): Promise<number> {
  const { pageCount } = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
      cancellable: true,
    },
    async (progress, token) =>
      withCancellationSignal(token, async (signal) => {
        signal.throwIfAborted();
        progress.report({ message: userMessage('message.progress.analyzingPdf') });
        return inspectPdfSummary(sourcePath, signal);
      }),
  );

  return pageCount;
}
