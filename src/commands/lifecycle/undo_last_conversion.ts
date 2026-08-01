import * as vscode from 'vscode';

import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import type { ConversionOutput } from '../../operations/lifecycle/undo_last_conversion.js';
import { UndoHistoryManager, type UndoManifestStorage } from '../../operations/lifecycle/undo_history_manager.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { userMessage } from '../shared/user_messages.js';

let undoHistory: UndoHistoryManager = new UndoHistoryManager();

export function initializeUndoHistory(options: {
  workspaceState: UndoManifestStorage;
  outputChannel?: LineOutputChannel;
}): void {
  undoHistory = new UndoHistoryManager({ storage: options.workspaceState });
  void undoHistory.initialize(options.outputChannel);
}

export async function recordConversionForUndo(
  outputs: ConversionOutput[],
  outputChannel?: LineOutputChannel,
): Promise<string> {
  return undoHistory.record(outputs, outputChannel);
}

export async function undoLastConversionCommand(
  expectedId?: string,
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;

  try {
    const outcome = await undoHistory.undo(expectedId, outputChannel);

    if (outcome === 'no-record') {
      await vscode.window.showInformationMessage(userMessage('message.undo.none'));
      return;
    }

    if (outcome === 'newer-conversion') {
      await vscode.window.showWarningMessage(userMessage('message.undo.newerConversionCompleted'));
      return;
    }

    await vscode.window.showInformationMessage(userMessage('message.undo.removedLastOutput'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.undo.failed', message));
  }
}
