import * as vscode from 'vscode';

import { isExcalidrawPath } from '../../application/policy/source_format.js';
import {
  convertExcalidrawToPdfFiles,
  type ExcalidrawPdfJob,
} from '../../operations/conversion/convert_excalidraw_to_pdf.js';
import { validateSvgToPdfOptions } from '../../operations/conversion/convert_to_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveSelectedUris } from '../shared/command_input.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { userMessage } from '../shared/user_messages.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { readSvgToPdfOptions } from './convert_to_pdf.js';

export async function convertExcalidrawToPdfCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;

  try {
    const sourceUris = resolveSelectedUris(uri, uris);
    if (sourceUris.length === 0) {
      throw new Error('No Excalidraw files were selected.');
    }

    const configuration = configureCommandRuntime(dependencies);
    const outputTemplate = configuration.outputPath.convertExcalidrawToPdf();
    const svgToPdfTools = readSvgToPdfOptions(configuration);
    validateSvgToPdfOptions(svgToPdfTools);
    const jobs = sourceUris.map((sourceUri) => planExcalidrawPdfJob(sourceUri, outputTemplate));

    await runConversionLifecycle({
      operationName: 'convert-excalidraw-to-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.convertExcalidrawToPdf.title', jobs.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'Excalidraw PDF'),
        successMessage: (count) => userMessage('message.convertExcalidrawToPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.convertExcalidrawToPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.convertExcalidrawToPdf.failed', reason),
      },
      run: async (runtime) => convertExcalidrawToPdfFiles({ jobs, svgToPdf: svgToPdfTools, runtime }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertExcalidrawToPdf.failed', message));
  }
}

function planExcalidrawPdfJob(sourceUri: vscode.Uri, outputTemplate: string): ExcalidrawPdfJob {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local Excalidraw files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The Excalidraw file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  if (!isExcalidrawPath(sourceUri.fsPath)) {
    throw new Error(`Only Excalidraw files are supported: ${sourceUri.fsPath}`);
  }

  return {
    sourcePath: sourceUri.fsPath,
    outputTemplate,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
  };
}
