import path from 'node:path';

import * as vscode from 'vscode';

import {
  rotatePdfProtocol,
  type PdfRotationAngle,
  type RotatePdfHostToWebview,
  type RotatePdfLabels,
  type RotatePdfWebviewToHost,
} from '@graphics-workbench/vscode-protocol/rotate-pdf-protocol';
import type { PdfPreviewSettings } from '@graphics-workbench/vscode-protocol/pdf-preview-protocol';
import { resolvePdfOutputPath } from '@graphics-workbench/core/output';
import { inspectPdfSummary, rotatePdfFiles } from '@graphics-workbench/core/pdf';
import { isAbortError } from '@graphics-workbench/core/runtime';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { createPdfJsResources } from '../../presentation/webview/pdfjs_assets.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import {
  runSinglePdfConfigureCommand,
  type SinglePdfConfigureConversion,
} from '../lifecycle/run_single_pdf_configure.js';
import { userMessage } from '../shared/user_messages.js';

export async function rotatePdfConfigureCommand(
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
      commandId: 'rotatePdf.configure',
      pageId: 'rotate-pdf',
      panelId: 'graphics-workbench.rotatePdf.configure',
      panelTitle: localeMap('submenu.rotatePdf'),
      protocol: rotatePdfProtocol,
      operationName: 'rotate-pdf-configure',
      messages: {
        progressTitle: userMessage('message.progress.rotatePdf.title', 1),
        prepareMessage: userMessage('message.progress.prepareRotatePdf'),
        successMessage: (count) => userMessage('message.rotatePdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.rotatePdf.cancelled'),
        failedMessage: (reason) => userMessage('message.rotatePdf.failed', reason),
      },
      prepare: async ({ inputUri, workspaceFolder, signal, report }) => {
        report(userMessage('message.progress.analyzingPdf'));
        const { pageCount } = await inspectPdfSummary(inputUri.fsPath, signal);

        if (pageCount === 0) {
          throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
        }

        return {
          pageCount,
          outputPath: resolvePdfOutputPath(dependencies.getConfiguration().outputPath.rotatePdf(), {
            workspacePath: workspaceFolder.uri.fsPath,
            workspaceName: workspaceFolder.name,
            sourcePath: inputUri.fsPath,
          }),
        };
      },
      buildInitPayload: ({ panel, pdfJsAssetsRoot, inputUri, prepared, configuration }) =>
        buildRotatePdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pageCount: prepared.pageCount,
          preview: readPdfPreviewSettings(configuration),
        }),
      isApplyMessage: isRotateApplyMessage,
      runApply: async (message, { inputUri, workspaceFolder, prepared, runConversion }) => {
        await applyConfiguredRotation({
          inputUri,
          workspacePath: workspaceFolder.uri.fsPath,
          outputPath: prepared.outputPath,
          pageCount: prepared.pageCount,
          angle: message.payload.angle,
          pageIndices: message.payload.pageIndices,
          runConversion,
        });
      },
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[rotate-pdf-configure] preview failure: ${message.payload.message}`);
        }
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[rotate-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.rotatePdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.rotatePdf.failed', message));
  }
}

function isRotateApplyMessage(
  message: RotatePdfWebviewToHost,
): message is Extract<RotatePdfWebviewToHost, { type: 'apply' }> {
  return message.type === 'apply';
}

function buildRotatePdfInitMessage(params: {
  panel: vscode.WebviewPanel;
  pdfJsAssetsRoot: vscode.Uri;
  inputUri: vscode.Uri;
  pageCount: number;
  preview: PdfPreviewSettings;
}): Extract<RotatePdfHostToWebview, { type: 'init' }>['payload'] {
  const { panel, pdfJsAssetsRoot, inputUri, pageCount, preview } = params;

  return {
    sourceId: 'source-1',
    fileName: path.basename(inputUri.fsPath),
    pageCount,
    pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
    resources: createPdfJsResources(panel.webview, pdfJsAssetsRoot),
    preview,
    labels: rotatePdfLabels(),
  };
}

async function applyConfiguredRotation(params: {
  inputUri: vscode.Uri;
  workspacePath: string;
  outputPath: string;
  pageCount: number;
  angle: PdfRotationAngle;
  pageIndices: number[];
  runConversion: (run: SinglePdfConfigureConversion) => Promise<void>;
}): Promise<void> {
  const { inputUri, workspacePath, outputPath, pageCount, angle, pageIndices, runConversion } = params;

  for (const page of pageIndices) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is out of range.`);
    }
  }

  await runConversion(async (runtime) =>
    rotatePdfFiles({
      inputs: [
        {
          sourcePath: inputUri.fsPath,
          workspacePath,
          outputPath,
          angle,
          pageIndices: pageIndices.map((page) => page - 1),
        },
      ],
      runtime,
    }),
  );
}

function rotatePdfLabels(): RotatePdfLabels {
  return {
    header: {
      title: localeMap('webview.rotatePdf.title'),
      description: localeMap('webview.rotatePdf.description'),
    },
    preview: {
      title: localeMap('webview.rotatePdf.preview'),
      description: localeMap('webview.rotatePdf.previewDescription'),
      ariaLabel: localeMap('webview.rotatePdf.previewAriaLabel'),
      renderError: localeMap('webview.rotatePdf.previewRenderError'),
      applyError: localeMap('webview.rotatePdf.previewApplyError'),
    },
    rotation: {
      title: localeMap('webview.rotatePdf.rotation'),
      angleLabel: localeMap('webview.rotatePdf.angleLabel'),
      selectAll: localeMap('webview.rotatePdf.selectAll'),
      selectAllAriaLabel: localeMap('webview.rotatePdf.selectAllAriaLabel'),
      pageToggle: localeMap('webview.rotatePdf.pageToggle'),
    },
    validation: {
      pagesRequired: localeMap('webview.rotatePdf.pagesRequiredError'),
      pageOutOfRange: localeMap('webview.rotatePdf.pageOutOfRangeError'),
      angleInvalid: localeMap('webview.rotatePdf.angleInvalid'),
    },
    actions: {
      apply: localeMap('webview.rotatePdf.apply'),
      cancel: localeMap('webview.rotatePdf.cancel'),
    },
  };
}
