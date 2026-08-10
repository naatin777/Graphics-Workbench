import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { localeMap } from '../../locale_map.js';
import { cropPdfFiles, type CropPdfInput } from '../../operations/pdf/crop_pdf_auto.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { isAbortError } from '../../shared/error.js';

export async function cropPdfAutoCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  try {
    if (sourceUris.length === 0) {
      throw new Error('No PDF files were selected.');
    }

    const configuration = dependencies.getConfiguration();
    const marginOptions = configuration.cropPdf.marginOptions();
    const selectedMargin = await selectMargin(marginOptions);

    if (selectedMargin === undefined) {
      return;
    }

    const outputTemplate = configuration.outputPath.cropPdf();
    const inputs = sourceUris.map((sourceUri) => planCropPdfInput(sourceUri, outputTemplate));
    await runConversionLifecycle({
      operationName: 'crop-pdf',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.cropPdf.title', inputs.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
        successMessage: (count) => userMessage('message.cropPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.cropPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.cropPdf.failed', reason),
      },
      run: async (runtime) => cropPdfFiles({ inputs, margin: selectedMargin, runtime }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.cropPdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.cropPdf.failed', message));
  }
}

function planCropPdfInput(sourceUri: vscode.Uri, outputTemplate: string): CropPdfInput {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Only PDF files can be cropped: ${sourcePath}`);
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

async function selectMargin(options: number[]): Promise<number | undefined> {
  const items = options.map((margin) => ({
    label: `${margin} pt`,
    description:
      margin === 0
        ? localeMap('quickPick.cropPdf.margin.detectedBounds')
        : localeMap('quickPick.cropPdf.margin.keepAroundContent').replace('{0}', margin.toString()),
    margin,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: localeMap('quickPick.cropPdf.margin.title'),
    placeHolder: localeMap('quickPick.cropPdf.margin.placeholder'),
  });

  return selected?.margin;
}
