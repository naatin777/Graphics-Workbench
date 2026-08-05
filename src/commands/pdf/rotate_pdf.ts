import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import {
  PDF_ROTATION_ANGLES,
  rotatePdfFiles,
  type PdfRotationAngle,
  type RotatePdfJob,
} from '../../operations/pdf/rotate_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { createProgressReporters } from '../lifecycle/progress_reporting.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo } from '../lifecycle/undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError, selectedUris } from '../shared/command_utils.js';

export async function rotatePdfCommand(
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

    const angle = await pickRotationAngle();

    if (angle === undefined) {
      return;
    }

    const configuration = getCommandConfiguration(dependencies);
    const outputTemplate = configuration.outputPath.rotatePdf();
    const jobs = sourceUris.map((sourceUri) => planRotatePdfJob(sourceUri, outputTemplate, angle));
    const outputs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: userMessage('message.progress.rotatePdf.title', jobs.length),
        cancellable: true,
      },
      async (progress, token) => {
        return withCancellationSignal(token, async (signal) => {
          progress.report({ message: userMessage('message.progress.prepareRotatePdf') });
          const runtime: ConversionExecutionContext = {
            signal,
            ...createProgressReporters(progress),
            ...(outputChannel !== undefined && { outputChannel }),
            resolveConflicts: resolveOutputConflicts,
          };
          return rotatePdfFiles({ jobs, runtime });
        });
      },
    );

    const successMessage = userMessage('message.rotatePdf.success', jobs.length);
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
      await vscode.window.showInformationMessage(userMessage('message.rotatePdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.rotatePdf.failed', message));
  }
}

async function pickRotationAngle(): Promise<PdfRotationAngle | undefined> {
  const items = PDF_ROTATION_ANGLES.map((angle) => ({ label: `${angle}°`, angle }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: userMessage('message.rotatePdf.pickAngle'),
  });
  return selected?.angle;
}

function planRotatePdfJob(sourceUri: vscode.Uri, outputTemplate: string, angle: PdfRotationAngle): RotatePdfJob {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Only PDF files can be rotated: ${sourcePath}`);
  }

  return {
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    outputPath: resolvePdfOutputPath(outputTemplate, {
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      sourcePath,
    }),
    angle,
  };
}
