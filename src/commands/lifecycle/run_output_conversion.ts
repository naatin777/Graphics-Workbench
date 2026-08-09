import * as vscode from 'vscode';
import path from 'node:path';

import type { CommittedConversionOutput } from '../../operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';

import { withCancellationSignal } from './progress_cancellation.js';
import { createProgressReporters } from './progress_reporting.js';
import { recordConversionForUndo } from './undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { isAbortError, toErrorMessage } from '../../shared/error.js';

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

/** Owns progress, cancellation, Undo registration, and user notifications for output conversion. */
export async function runConversionLifecycle(options: {
  operationName: string;
  messages: ConversionCommandMessages;
  outputChannel?: LineOutputChannel;
  resolveConflicts?: ConversionExecutionContext['resolveConflicts'];
  run: (runtime: ConversionExecutionContext) => Promise<CommittedConversionOutput[]>;
}): Promise<void> {
  let outputs: CommittedConversionOutput[];

  try {
    outputs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.messages.progressTitle,
        cancellable: true,
      },
      async (progress, token) =>
        withCancellationSignal(token, async (signal) => {
          progress.report({ message: options.messages.prepareMessage });
          const runtimeOptions: ConversionExecutionContext = {
            signal,
            ...createProgressReporters(progress),
          };
          if (options.outputChannel !== undefined) {
            runtimeOptions.outputChannel = options.outputChannel;
          }
          if (options.resolveConflicts !== undefined) {
            runtimeOptions.resolveConflicts = options.resolveConflicts;
          }
          return options.run(runtimeOptions);
        }),
    );
  } catch (error) {
    if (isAbortError(error)) {
      options.outputChannel?.appendLine(`[${options.operationName}] cancellation requested`);
      await vscode.window.showInformationMessage(options.messages.cancelledMessage);
      return;
    }

    const reason = toErrorMessage(error);
    options.outputChannel?.appendLine(`[${options.operationName}] failure: ${reason}`);
    await vscode.window.showErrorMessage(options.messages.failedMessage(reason));
    return;
  }

  const successMessage = options.messages.successMessage(outputs.length);
  let undoId: string;

  try {
    undoId = await recordConversionForUndo(outputs, options.outputChannel);
  } catch (error) {
    const reason = toErrorMessage(error);
    options.outputChannel?.appendLine(`[${options.operationName}] Undo record failed: ${reason}`);
    await vscode.window.showWarningMessage(options.messages.undoUnavailableMessage(successMessage, reason));
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
    options.outputChannel?.appendLine(
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
