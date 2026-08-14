import path from 'node:path';

import * as vscode from 'vscode';

import {
  type CropBox,
  type CropConfigureHostToWebview,
  type CropTarget,
  cropPdfProtocol,
} from '@graphics-workbench/vscode-protocol/crop-pdf-protocol';
import type { PdfPreviewSettings } from '@graphics-workbench/vscode-protocol/pdf-preview-protocol';
import type { PdfPageGeometry } from '@graphics-workbench/core/pdf';
import { resolvePdfOutputPath } from '@graphics-workbench/core/output';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeCatalog, localeMap } from '../../locale_map.js';
import {
  isAbortError,
  OperationCancelledError,
  type CommittedConversionOutput,
  type ConversionExecutionContext,
} from '@graphics-workbench/core/runtime';
import { cropPdfWithConfiguredBox } from '../../adapters/crop/crop_pdf_configure.js';
import { createPdfJsResources } from '../../presentation/webview/pdfjs_assets.js';
import { runCropWorker, type CropPdfMetadata } from '@graphics-workbench/core/crop-worker';
import { matchError } from 'better-result';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { runSinglePdfConfigureCommand } from '../lifecycle/run_single_pdf_configure.js';
import { userMessage } from '../shared/user_messages.js';

export async function cropPdfConfigureCommand(
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
      commandId: 'cropPdf.configure',
      pageId: 'crop-pdf',
      panelId: 'graphics-workbench.cropPdf.configure',
      panelTitle: localeMap('submenu.cropPdf'),
      protocol: cropPdfProtocol,
      operationName: 'crop-pdf-configure',
      messages: {
        progressTitle: userMessage('message.progress.cropPdf.title', 1),
        prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
        successMessage: (count) => userMessage('message.cropPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.cropPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.cropPdf.failed', reason),
      },
      prepare: async ({ inputUri, signal, report }) => {
        report(userMessage('message.progress.prepareConversion', 'PDF'));
        const inspectResult = await runCropWorker({ type: 'inspect', filePath: inputUri.fsPath }, signal);
        if (inspectResult.isErr()) {
          throw matchError(inspectResult.error, {
            CropWorkerCancelledError: (error) => new OperationCancelledError(error.message),
            CropWorkerFailedError: (error) => error,
          });
        }
        const pdf = inspectResult.value;

        if (pdf === undefined) {
          throw new Error('Crop Configure metadata inspection returned no result.');
        }

        return {
          pdf,
          outputTemplate: dependencies.getConfiguration().outputPath.cropPdf(),
        };
      },
      buildInitPayload: ({ panel, pdfJsAssetsRoot, inputUri, prepared, configuration }) =>
        buildCropPdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pdf: prepared.pdf,
          preview: readPdfPreviewSettings(configuration),
        }),
      apply: async (payload, { inputUri, workspaceFolder, prepared, runtime }) =>
        applyConfiguredCrop({
          inputUri,
          workspaceFolder,
          outputTemplate: prepared.outputTemplate,
          crop: {
            cropBox: payload.cropBox,
            target: payload.target,
            pageGeometry: prepared.pdf.pages,
          },
          runtime,
        }),
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[crop-pdf-configure] preview failure: ${message.payload.message}`);
          void vscode.window.showErrorMessage(message.payload.message);
        }
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[crop-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.cropPdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.cropPdf.failed', message));
  }
}

function buildCropPdfInitMessage(params: {
  panel: vscode.WebviewPanel;
  pdfJsAssetsRoot: vscode.Uri;
  inputUri: vscode.Uri;
  pdf: CropPdfMetadata;
  preview: PdfPreviewSettings;
}): Extract<CropConfigureHostToWebview, { type: 'init' }>['payload'] {
  const { panel, pdfJsAssetsRoot, inputUri, pdf, preview } = params;

  return {
    pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
    resources: createPdfJsResources(panel.webview, pdfJsAssetsRoot),
    preview,
    fileName: path.basename(inputUri.fsPath),
    pageCount: pdf.pageCount,
    initialPage: 1,
    pageGeometry: pdf.pages,
    initialCropBox: initialCropBoxForPages(pdf.pages),
    labels: localeCatalog(),
  };
}

async function applyConfiguredCrop(params: {
  inputUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  outputTemplate: string;
  crop: {
    cropBox: CropBox;
    target: CropTarget;
    pageGeometry: PdfPageGeometry[];
  };
  runtime: ConversionExecutionContext;
}): Promise<CommittedConversionOutput[]> {
  const { inputUri, workspaceFolder, outputTemplate, crop, runtime } = params;
  const sourcePath = inputUri.fsPath;
  const outputPath = resolvePdfOutputPath(outputTemplate, {
    workspacePath: workspaceFolder.uri.fsPath,
    workspaceName: workspaceFolder.name,
    sourcePath,
  });
  validateCropBoxForTarget(crop.cropBox, crop.target, crop.pageGeometry);

  return cropPdfWithConfiguredBox({
    input: {
      sourcePath,
      workspacePath: workspaceFolder.uri.fsPath,
      outputPath,
      cropBox: crop.cropBox,
      target: crop.target,
    },
    runtime,
  });
}

function validateCropBoxForTarget(cropBox: CropBox, target: CropTarget, pageGeometry: PdfPageGeometry[]): void {
  const pages = target.type === 'all' ? pageGeometry : target.pages.map((page) => pageGeometry[page - 1]);
  for (const geometry of pages) {
    if (geometry === undefined) {
      throw new Error('Selected page metadata is unavailable. Close and reopen Crop Configure.');
    }

    const mediaRight = geometry.mediaBox.x + geometry.mediaBox.width;
    const mediaTop = geometry.mediaBox.y + geometry.mediaBox.height;
    if (
      cropBox.left < geometry.mediaBox.x ||
      cropBox.bottom < geometry.mediaBox.y ||
      cropBox.right > mediaRight ||
      cropBox.top > mediaTop
    ) {
      throw new Error(`Crop box must be inside page ${geometry.page} media box.`);
    }
  }
}

function initialCropBoxForPages(pageGeometry: PdfPageGeometry[]): CropBox {
  const [firstPage] = pageGeometry;
  if (firstPage === undefined) {
    return { left: 0, bottom: 0, right: 0, top: 0 };
  }

  const commonCropBox = {
    left: firstPage.cropBox.x,
    bottom: firstPage.cropBox.y,
    right: firstPage.cropBox.x + firstPage.cropBox.width,
    top: firstPage.cropBox.y + firstPage.cropBox.height,
  };
  for (const geometry of pageGeometry.slice(1)) {
    commonCropBox.left = Math.max(commonCropBox.left, geometry.cropBox.x);
    commonCropBox.bottom = Math.max(commonCropBox.bottom, geometry.cropBox.y);
    commonCropBox.right = Math.min(commonCropBox.right, geometry.cropBox.x + geometry.cropBox.width);
    commonCropBox.top = Math.min(commonCropBox.top, geometry.cropBox.y + geometry.cropBox.height);
  }

  return commonCropBox.left < commonCropBox.right && commonCropBox.bottom < commonCropBox.top
    ? commonCropBox
    : {
        left: firstPage.cropBox.x,
        bottom: firstPage.cropBox.y,
        right: firstPage.cropBox.x + firstPage.cropBox.width,
        top: firstPage.cropBox.y + firstPage.cropBox.height,
      };
}
