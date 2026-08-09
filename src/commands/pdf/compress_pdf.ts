import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { compressPdfFiles, type CompressPdfJob } from '../../operations/pdf/compress_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { isAbortError } from '../../shared/error.js';
import { resolveSelectedUris } from '../shared/command_input.js';

export async function compressPdfCommand(
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

    const configuration = configureCommandRuntime(dependencies);
    const outputTemplate = configuration.outputPath.compressPdf();
    const jobs = sourceUris.map((sourceUri) => planCompressPdfJob(sourceUri, outputTemplate));
    await runConversionLifecycle({
      operationName: 'compress-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.compressPdf.title', jobs.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
        successMessage: (count) => userMessage('message.compressPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.compressPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.compressPdf.failed', reason),
      },
      run: async (runtime) => compressPdfFiles({ jobs, runtime }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.compressPdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.compressPdf.failed', message));
  }
}

function planCompressPdfJob(sourceUri: vscode.Uri, outputTemplate: string): CompressPdfJob {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Only PDF files can be compressed: ${sourcePath}`);
  }

  return {
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    outputPath: resolvePdfOutputPath(outputTemplate, {
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      sourcePath,
    }),
  };
}
