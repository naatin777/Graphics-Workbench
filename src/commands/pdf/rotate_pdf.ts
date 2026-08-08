import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import {
  PDF_ROTATION_ANGLES,
  rotatePdfFiles,
  type PdfRotationAngle,
  type RotatePdfJob,
} from '../../operations/pdf/rotate_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { isAbortError } from '../../shared/error.js';
import { resolveSelectedUris } from '../shared/command_input.js';

export async function rotatePdfCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = resolveSelectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No PDF files were selected.');
    }

    const angle = await pickRotationAngle();

    if (angle === undefined) {
      return;
    }

    const configuration = configureCommandRuntime(dependencies);
    const outputTemplate = configuration.outputPath.rotatePdf();
    const jobs = sourceUris.map((sourceUri) => planRotatePdfJob(sourceUri, outputTemplate, angle));
    await runConversionLifecycle({
      operationName: 'rotate-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.rotatePdf.title', jobs.length),
        prepareMessage: userMessage('message.progress.prepareRotatePdf'),
        successMessage: (count) => userMessage('message.rotatePdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.rotatePdf.cancelled'),
        failedMessage: (reason) => userMessage('message.rotatePdf.failed', reason),
      },
      run: async (runtime) => rotatePdfFiles({ jobs, runtime }),
    });
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
