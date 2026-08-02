import path from 'node:path';

import * as vscode from 'vscode';

import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { linearizePdfFiles, type LinearizePdfJob } from '../../operations/pdf/linearize_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { createProgressReporters } from '../lifecycle/progress_reporting.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo } from '../lifecycle/undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError, selectedUris } from '../shared/command_utils.js';

export async function linearizePdfCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = selectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No PDF files were selected.');
    }

    const configuration = getCommandConfiguration(dependencies);
    const outputTemplate = configuration.outputPath.linearizePdf();
    const jobs = sourceUris.map((sourceUri) => planLinearizePdfJob(sourceUri, outputTemplate));
    const qpdfPath = configuration.execPath.qpdf();
    const outputs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: userMessage('message.progress.linearizePdf.title', jobs.length),
        cancellable: true,
      },
      async (progress, token) => {
        return withCancellationSignal(token, async (signal) => {
          progress.report({ message: userMessage('message.progress.prepareLinearizePdf') });
          const runtime: ConversionExecutionContext = {
            signal,
            ...createProgressReporters(progress),
            ...(outputChannel !== undefined && { outputChannel }),
            resolveConflicts: resolveOutputConflicts,
          };
          return linearizePdfFiles({ jobs, qpdfPath, runtime });
        });
      },
    );

    const successMessage = userMessage('message.linearizePdf.success', jobs.length);
    let undoId: string;

    try {
      undoId = await recordConversionForUndo(outputs, outputChannel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showWarningMessage(userMessage('message.undoUnavailable', successMessage, message));
      return;
    }

    const undoAction = userMessage('message.action.undo');
    const selectedAction = await vscode.window.showInformationMessage(successMessage, undoAction);

    if (selectedAction === undoAction) {
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion', undoId);
    }
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.linearizePdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.linearizePdf.failed', message));
  }
}

function planLinearizePdfJob(sourceUri: vscode.Uri, outputTemplate: string): LinearizePdfJob {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Only PDF files can be linearized: ${sourcePath}`);
  }

  return {
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    outputPath: resolveOutputPath(outputTemplate, {
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      sourcePath,
    }),
  };
}
