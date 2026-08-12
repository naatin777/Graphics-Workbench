import * as vscode from 'vscode';
import path from 'node:path';

import {
  isAbortError,
  toErrorMessage,
  type CommittedConversionOutput,
  type ConversionExecutionContext,
} from '@graphics-workbench/core/runtime';
import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';

import { withCancellationSignal } from './progress_cancellation.js';
import { createProgressReporters } from './progress_reporting.js';
import { recordConversionForUndo } from './undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';

export interface ConversionCommandMessages {
  progressTitle: string;
  prepareMessage: string;
  successMessage: (count: number) => string;
  undoUnavailableMessage: (successMessage: string, reason: string) => string;
  cancelledMessage: string;
  failedMessage: (reason: string) => string;
}

export type OutputConversionFormat = 'PDF' | 'PNG' | 'JPEG' | 'WebP' | 'AVIF' | 'GIF' | 'TIFF' | 'SVG' | 'Draw.io';

export function createOutputConversionMessages(
  format: OutputConversionFormat,
  sourceCount: number,
): ConversionCommandMessages {
  return {
    progressTitle: userMessage('message.progress.convertToOutput.title', sourceCount, format),
    prepareMessage: userMessage('message.progress.prepareConversion', format),
    successMessage: (count) => userMessage('message.convertToOutput.success', count, format),
    undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
    cancelledMessage: userMessage('message.convertToOutput.cancelled', format),
    failedMessage: (reason) => userMessage('message.convertToOutput.failed', format, reason),
  };
}

export interface ConversionLifecycleCallbacks {
  /** Parent cancellation signal (e.g. a Configure panel session) forwarded into the operation. */
  signal?: AbortSignal;
  /** Runs instead of the default success notification after Undo is recorded. */
  onSuccess?: (options: {
    outputs: CommittedConversionOutput[];
    undoId: string;
    successMessage: string;
  }) => Promise<void>;
  /** Runs instead of the default undo-unavailable warning. */
  onUndoUnavailable?: (options: { successMessage: string; reason: string }) => Promise<void>;
  /** Runs after the failure notification so callers can route the error (e.g. to a Webview). */
  // oxlint-disable-next-line typescript/no-restricted-types -- catch由来エラーを通知するコールバック。
  onError?: (error: unknown) => Promise<void>;
}

/** Owns progress, cancellation, Undo registration, and user notifications for output conversion. */
export async function runConversionLifecycle(
  options: {
    operationName: string;
    messages: ConversionCommandMessages;
    outputChannel: LineOutputChannel;
    resolveConflicts: NonNullable<ConversionExecutionContext['resolveConflicts']>;
    run: (runtime: ConversionExecutionContext) => Promise<CommittedConversionOutput[]>;
  } & ConversionLifecycleCallbacks,
): Promise<void> {
  let outputs: CommittedConversionOutput[];

  try {
    outputs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.messages.progressTitle,
        cancellable: true,
      },
      async (progress, token) =>
        withCancellationSignal(
          token,
          async (signal) => {
            progress.report({ message: options.messages.prepareMessage });
            const runtimeOptions: ConversionExecutionContext = {
              signal,
              outputChannel: options.outputChannel,
              resolveConflicts: options.resolveConflicts,
              ...createProgressReporters(progress),
            };
            return options.run(runtimeOptions);
          },
          options.signal,
        ),
    );
  } catch (error) {
    if (isAbortError(error)) {
      options.outputChannel.appendLine(`[${options.operationName}] cancellation requested`);
      await vscode.window.showInformationMessage(options.messages.cancelledMessage);
      return;
    }

    const reason = toErrorMessage(error);
    options.outputChannel.appendLine(`[${options.operationName}] failure: ${reason}`);
    await vscode.window.showErrorMessage(options.messages.failedMessage(reason));
    await options.onError?.(error);
    return;
  }

  const successMessage = options.messages.successMessage(outputs.length);
  let undoId: string;

  try {
    undoId = await recordConversionForUndo(outputs, options.outputChannel);
  } catch (error) {
    const reason = toErrorMessage(error);
    options.outputChannel.appendLine(`[${options.operationName}] Undo record failed: ${reason}`);
    if (options.onUndoUnavailable !== undefined) {
      try {
        await options.onUndoUnavailable({ successMessage, reason });
      } catch (uiError) {
        options.outputChannel.appendLine(
          `[${options.operationName}] undo-unavailable notification failed: ${toErrorMessage(uiError)}`,
        );
      }
      return;
    }
    await vscode.window.showWarningMessage(options.messages.undoUnavailableMessage(successMessage, reason));
    return;
  }

  if (options.onSuccess !== undefined) {
    try {
      await options.onSuccess({ outputs, undoId, successMessage });
    } catch (error) {
      // The conversion already succeeded; a UI failure here must not be reported as a conversion failure.
      options.outputChannel.appendLine(
        `[${options.operationName}] success notification failed: ${toErrorMessage(error)}`,
      );
    }
    return;
  }

  const undoAction = userMessage('message.action.undo');
  const revealAction = userMessage('message.action.revealInExplorer');
  try {
    const selectedAction = await vscode.window.showInformationMessage(successMessage, undoAction, revealAction);
    if (selectedAction === undoAction) {
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion', undoId);
    } else if (selectedAction === revealAction) {
      await revealOutputsInExplorer(outputs);
    }
  } catch (error) {
    // The conversion already succeeded; a UI failure here must not be reported as a conversion failure.
    options.outputChannel.appendLine(
      `[${options.operationName}] success notification failed: ${toErrorMessage(error)}`,
    );
  }
}

async function revealOutputsInExplorer(outputs: CommittedConversionOutput[]): Promise<void> {
  const [first] = outputs;
  if (first === undefined) {
    return;
  }

  if (outputs.length === 1) {
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(first.outputPath));
    return;
  }

  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(path.dirname(first.outputPath)));
}
