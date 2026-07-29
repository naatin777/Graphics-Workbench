import path from 'node:path';

import * as vscode from 'vscode';

import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { readGhostscriptExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { localeMap } from '../../locale_map.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { compressPdfFiles, type CompressPdfJob, type GhostscriptQuality } from '../../operations/pdf/compress_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo, UNDO_LAST_CONVERSION_COMMAND } from '../lifecycle/undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError, selectedUris } from '../shared/command_utils.js';

const qualityOptions: { quality: GhostscriptQuality; label: string; description: string }[] = [
  { quality: 'screen', label: 'Screen', description: localeMap('quickPick.compressPdf.quality.screen') },
  { quality: 'ebook', label: 'eBook', description: localeMap('quickPick.compressPdf.quality.ebook') },
  { quality: 'printer', label: 'Printer', description: localeMap('quickPick.compressPdf.quality.printer') },
  { quality: 'prepress', label: 'Prepress', description: localeMap('quickPick.compressPdf.quality.prepress') },
  { quality: 'default', label: 'Default', description: localeMap('quickPick.compressPdf.quality.default') },
];
export const COMPRESS_PDF_COMMAND = 'graphics-workbench.compressPdf';

export async function compressPdfCommand(
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
    const outputTemplate = configuration.outputPath.compressPdf();
    const quality = await selectQuality();

    if (quality === undefined) {
      return;
    }

    const jobs = sourceUris.map((sourceUri) => planCompressPdfJob(sourceUri, outputTemplate));
    const ghostscriptPath = readGhostscriptExecutablePath(configuration);
    const outputs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: userMessage('message.progress.compressPdf.title', jobs.length),
        cancellable: true,
      },
      async (progress, token) => {
        return withCancellationSignal(token, async (signal) => {
          progress.report({ message: userMessage('message.progress.prepareConversion', 'PDF') });
          const runtime: ConversionExecutionContext = {
            signal,
            ...(outputChannel !== undefined && { outputChannel }),
            resolveConflicts: resolveOutputConflicts,
          };
          return compressPdfFiles({
            jobs,
            quality,
            ghostscriptPath,
            runtime,
          });
        });
      },
    );

    const successMessage = userMessage('message.compressPdf.success', jobs.length);
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
      await vscode.commands.executeCommand(UNDO_LAST_CONVERSION_COMMAND, undoId);
    }
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
    outputPath: resolveOutputPath(outputTemplate, {
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      sourcePath,
    }),
  };
}

async function selectQuality(): Promise<GhostscriptQuality | undefined> {
  const selected = await vscode.window.showQuickPick(qualityOptions, {
    title: localeMap('quickPick.compressPdf.quality.title'),
    placeHolder: localeMap('quickPick.compressPdf.quality.placeholder'),
  });

  return selected?.quality;
}
