import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '@graphics-workbench/core/output';
import {
  PDF_ROTATION_ANGLES,
  rotatePdfFiles,
  type PdfRotationAngle,
  type RotatePdfInput,
} from '@graphics-workbench/core/pdf';
import { toConversionResult } from '@graphics-workbench/core/conversion';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';

export async function rotatePdfCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(userMessage('message.rotatePdf.failed', 'No PDF files were selected.'));
    return;
  }

  const angle = await pickRotationAngle();
  if (angle === undefined) {
    return;
  }

  const configuration = dependencies.getConfiguration();
  const outputTemplate = configuration.outputPath.rotatePdf();
  await runConversionLifecycle({
    operationName: 'rotate-pdf',
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: {
      progressTitle: userMessage('message.progress.rotatePdf.title', sourceUris.length),
      prepareMessage: userMessage('message.progress.prepareRotatePdf'),
      successMessage: (count) => userMessage('message.rotatePdf.success', count),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage('message.rotatePdf.cancelled'),
      failedMessage: (reason) => userMessage('message.rotatePdf.failed', reason),
    },
    run: async (runtime) => {
      const inputs = sourceUris.map((sourceUri) => planRotatePdfInput(sourceUri, outputTemplate, angle));
      return toConversionResult(async () => rotatePdfFiles({ inputs, runtime }), runtime.signal);
    },
  });
}

async function pickRotationAngle(): Promise<PdfRotationAngle | undefined> {
  const items = PDF_ROTATION_ANGLES.map((angle) => ({ label: `${angle}°`, angle }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: userMessage('message.rotatePdf.pickAngle'),
  });
  return selected?.angle;
}

function planRotatePdfInput(sourceUri: vscode.Uri, outputTemplate: string, angle: PdfRotationAngle): RotatePdfInput {
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
