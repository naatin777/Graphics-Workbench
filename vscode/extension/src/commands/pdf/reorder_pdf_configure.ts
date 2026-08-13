import path from 'node:path';

import * as vscode from 'vscode';

import {
  reorderPdfProtocol,
  type ReorderPdfHostToWebview,
  type ReorderPdfWebviewToHost,
} from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';
import type { PdfPreviewSettings } from '@graphics-workbench/vscode-protocol/pdf-preview-protocol';
import { resolvePdfOutputPath } from '@graphics-workbench/core/output';
import { inspectPdfSummary, reorderPdfFiles } from '@graphics-workbench/core/pdf';
import { isAbortError } from '@graphics-workbench/core/runtime';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeCatalog, localeMap } from '../../locale_map.js';
import { createPdfJsResources } from '../../presentation/webview/pdfjs_assets.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import {
  runSinglePdfConfigureCommand,
  type SinglePdfConfigureConversion,
} from '../lifecycle/run_single_pdf_configure.js';
import { userMessage } from '../shared/user_messages.js';

export async function reorderPdfConfigureCommand(
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const { outputChannel } = dependencies;

  try {
    await runSinglePdfConfigureCommand({
      context,
      sourceUris,
      dependencies,
      commandId: 'reorderPdf.configure',
      pageId: 'reorder-pdf',
      panelId: 'graphics-workbench.reorderPdf.configure',
      panelTitle: localeMap('submenu.reorderPdf'),
      protocol: reorderPdfProtocol,
      operationName: 'reorder-pdf-configure',
      messages: {
        progressTitle: userMessage('message.progress.reorderPdf.title', 1),
        prepareMessage: userMessage('message.progress.prepareReorderPdf'),
        successMessage: (count) => userMessage('message.reorderPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.reorderPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.reorderPdf.failed', reason),
      },
      prepare: async ({ inputUri, workspaceFolder, signal, report }) => {
        report(userMessage('message.progress.analyzingPdf'));
        const { pageCount } = await inspectPdfSummary(inputUri.fsPath, signal);

        if (pageCount === 0) {
          throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
        }

        return {
          pageCount,
          outputPath: resolvePdfOutputPath(dependencies.getConfiguration().outputPath.reorderPdf(), {
            workspacePath: workspaceFolder.uri.fsPath,
            workspaceName: workspaceFolder.name,
            sourcePath: inputUri.fsPath,
          }),
        };
      },
      buildInitPayload: ({ panel, pdfJsAssetsRoot, inputUri, prepared, configuration }) =>
        buildReorderPdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pageCount: prepared.pageCount,
          preview: readPdfPreviewSettings(configuration),
        }),
      isApplyMessage: isReorderApplyMessage,
      runApply: async (message, { inputUri, workspaceFolder, prepared, runConversion }) => {
        await applyConfiguredReorder({
          inputUri,
          workspacePath: workspaceFolder.uri.fsPath,
          outputPath: prepared.outputPath,
          pageCount: prepared.pageCount,
          order: message.payload.order,
          runConversion,
        });
      },
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[reorder-pdf-configure] preview failure: ${message.payload.message}`);
        }
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[reorder-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.reorderPdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.reorderPdf.failed', message));
  }
}

function isReorderApplyMessage(
  message: ReorderPdfWebviewToHost,
): message is Extract<ReorderPdfWebviewToHost, { type: 'apply' }> {
  return message.type === 'apply';
}

function buildReorderPdfInitMessage(params: {
  panel: vscode.WebviewPanel;
  pdfJsAssetsRoot: vscode.Uri;
  inputUri: vscode.Uri;
  pageCount: number;
  preview: PdfPreviewSettings;
}): Extract<ReorderPdfHostToWebview, { type: 'init' }>['payload'] {
  const { panel, pdfJsAssetsRoot, inputUri, pageCount, preview } = params;

  return {
    sourceId: 'source-1',
    fileName: path.basename(inputUri.fsPath),
    pageCount,
    pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
    resources: createPdfJsResources(panel.webview, pdfJsAssetsRoot),
    preview,
    labels: localeCatalog(),
  };
}

async function applyConfiguredReorder(params: {
  inputUri: vscode.Uri;
  workspacePath: string;
  outputPath: string;
  pageCount: number;
  order: number[];
  runConversion: (run: SinglePdfConfigureConversion) => Promise<void>;
}): Promise<void> {
  const { inputUri, workspacePath, outputPath, pageCount, order, runConversion } = params;

  if (order.length !== pageCount) {
    throw new Error(`Page order must contain exactly ${pageCount} pages.`);
  }

  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is out of range.`);
    }
  }

  await runConversion(async (runtime) =>
    reorderPdfFiles({
      inputs: [{ sourcePath: inputUri.fsPath, workspacePath, outputPath, pageOrder: order }],
      runtime,
    }),
  );
}
