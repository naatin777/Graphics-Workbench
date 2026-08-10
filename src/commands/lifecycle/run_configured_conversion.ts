import * as vscode from 'vscode';

import type { CommittedConversionOutput } from '../../operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { toErrorMessage } from '../../shared/error.js';

import { userMessage } from '../shared/user_messages.js';
import { resolveOutputConflicts } from './safe_mode.js';
import { runConversionLifecycle, type ConversionCommandMessages } from './run_output_conversion.js';

/**
 * Runs a Configure input through the standard lifecycle: progress,
 * cancellation (with the panel session as parent), Safe Mode conflict
 * resolution, Undo recording, panel disposal, and notifications.
 */
export async function runConfiguredPdfConversion(options: {
  operationName: string;
  messages: ConversionCommandMessages;
  outputChannel: LineOutputChannel;
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
  run: (runtime: ConversionExecutionContext) => Promise<CommittedConversionOutput[]>;
}): Promise<void> {
  await runConversionLifecycle({
    operationName: options.operationName,
    messages: options.messages,
    outputChannel: options.outputChannel,
    resolveConflicts: resolveOutputConflicts,
    signal: options.signal,
    onSuccess: async ({ undoId, successMessage }) => {
      options.panel.dispose();
      const undoAction = userMessage('message.action.undo');
      const selectedAction = await vscode.window.showInformationMessage(successMessage, undoAction);
      if (selectedAction === undoAction) {
        await vscode.commands.executeCommand('graphics-workbench.undoLastConversion', undoId);
      }
    },
    onUndoUnavailable: async ({ successMessage, reason }) => {
      options.panel.dispose();
      await vscode.window.showWarningMessage(userMessage('message.undoUnavailable', successMessage, reason));
    },
    onError: async (error) => {
      const message = toErrorMessage(error);
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Webview.postMessage has no targetOrigin parameter.
        void options.panel.webview.postMessage({ type: 'error', payload: { message } });
      } catch {
        // The panel may already be disposed; the error notification still informs the user.
      }
    },
    run: options.run,
  });
}
