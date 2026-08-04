import path from 'node:path';

import * as vscode from 'vscode';

import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { linearizePdfFiles, type LinearizePdfJob } from '../../operations/pdf/linearize_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
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
    await runConversionLifecycle({
      operationName: 'linearize-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.linearizePdf.title', jobs.length),
        prepareMessage: userMessage('message.progress.prepareLinearizePdf'),
        successMessage: (count) => userMessage('message.linearizePdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.linearizePdf.cancelled'),
        failedMessage: (reason) => userMessage('message.linearizePdf.failed', reason),
      },
      run: async (runtime) => linearizePdfFiles({ jobs, qpdfPath, runtime }),
    });
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
