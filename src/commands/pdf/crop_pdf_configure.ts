import path from 'node:path';
import * as vscode from 'vscode';

import {
  type CropBox,
  type CropConfigureHostToWebview,
  type CropConfigureWebviewToHost,
  type CropPdfLabels,
  type PdfPageGeometry,
  type CropTarget,
  isCropConfigureMessage,
} from '../../shared/protocols/crop_pdf_protocol.js';
import type { PdfPreviewSettings } from '../../shared/protocols/pdf_preview_protocol.js';
import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { isAbortError } from '../../shared/error.js';
import { cropPdfWithConfiguredBox } from '../../operations/pdf/crop_pdf_configure.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import {
  createPdfJsResources,
  getPdfJsAssetsRoot,
  getWebviewSharedAssetsRoot,
} from '../../presentation/webview/pdfjs_assets.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { inspectCropPdfMetadata } from '../../operations/pdf/run_crop_pdf_metadata.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { startPdfConfigureSession } from '../lifecycle/pdf_configure_session.js';
import { runConfiguredPdfConversion } from '../lifecycle/run_configured_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { resolveSingleConfiguredPdfUri } from '../shared/command_input.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';

export async function cropPdfConfigureCommand(
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  try {
    await runCropPdfConfigureCommand(context, sourceUris, dependencies);
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

async function runCropPdfConfigureCommand(
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  const inputUri = resolveSingleConfiguredPdfUri(sourceUris, 'cropPdf.configure');
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(inputUri);

  if (!workspaceFolder) {
    throw new Error('cropPdf.configure input must be inside the workspace.');
  }

  await assertExistingPathInWorkspace(inputUri.fsPath, workspaceFolder.uri.fsPath);

  const pdf = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: userMessage('message.progress.cropPdf.title', 1),
      cancellable: true,
    },
    async (progress, token) =>
      withCancellationSignal(token, async (signal) => {
        progress.report({ message: userMessage('message.progress.prepareConversion', 'PDF') });
        return inspectCropPdfMetadata(inputUri.fsPath, signal);
      }),
  );
  const configuration = dependencies.getConfiguration();
  const outputTemplate = configuration.outputPath.cropPdf();
  const pdfJsAssetsRoot = getPdfJsAssetsRoot(context.extensionUri);
  const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(context.extensionUri);

  const panelTitle = localeMap('submenu.cropPdf');
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'crop_pdf');
  startPdfConfigureSession({
    panel: {
      id: 'graphics-workbench.cropPdf.configure',
      title: panelTitle,
      appRoot,
      localResourceRoots: [
        appRoot,
        pdfJsAssetsRoot,
        webviewSharedAssetsRoot,
        vscode.Uri.file(path.dirname(inputUri.fsPath)),
      ],
    },
    webview: {
      title: panelTitle,
      appName: 'crop_pdf',
      extensionUri: context.extensionUri,
      locale: vscode.env.language,
    },
    message: {
      isWebviewToHostMessage: isCropConfigureMessage,
      isApplyMessage: isCropApplyMessage,
      buildInitMessage: (panel) =>
        buildCropPdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pdf,
          preview: readPdfPreviewSettings(configuration),
        }),
      runApply: async (message, { panel, signal }) => {
        await applyConfiguredCrop({
          inputUri,
          workspaceFolder,
          outputTemplate,
          crop: {
            cropBox: message.payload.cropBox,
            target: message.payload.target,
            pageGeometry: pdf.pages,
          },
          panel,
          signal,
          outputChannel,
        });
      },
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[crop-pdf-configure] preview failure: ${message.payload.message}`);
          void vscode.window.showErrorMessage(message.payload.message);
        }
      },
    },
    error: {
      operationName: 'crop-pdf-configure',
      cancelledMessage: userMessage('message.cropPdf.cancelled'),
      failedMessage: (reason) => userMessage('message.cropPdf.failed', reason),
    },
    outputChannel,
    extensionShutdown: { context },
  });
}

function isCropApplyMessage(
  message: CropConfigureWebviewToHost,
): message is Extract<CropConfigureWebviewToHost, { type: 'apply' }> {
  return message.type === 'apply';
}

function buildCropPdfInitMessage(params: {
  panel: vscode.WebviewPanel;
  pdfJsAssetsRoot: vscode.Uri;
  inputUri: vscode.Uri;
  pdf: Awaited<ReturnType<typeof inspectCropPdfMetadata>>;
  preview: PdfPreviewSettings;
}): CropConfigureHostToWebview {
  const { panel, pdfJsAssetsRoot, inputUri, pdf, preview } = params;

  return {
    type: 'init',
    payload: {
      pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
      resources: createPdfJsResources(panel.webview, pdfJsAssetsRoot),
      preview,
      fileName: path.basename(inputUri.fsPath),
      pageCount: pdf.pageCount,
      initialPage: 1,
      pageGeometry: pdf.pages,
      initialCropBox: initialCropBoxForPages(pdf.pages),
      labels: cropPdfLabels(),
    },
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
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
  outputChannel: LineOutputChannel;
}): Promise<void> {
  const { inputUri, workspaceFolder, outputTemplate, crop, panel, signal, outputChannel } = params;
  const sourcePath = inputUri.fsPath;
  const outputPath = resolvePdfOutputPath(outputTemplate, {
    workspacePath: workspaceFolder.uri.fsPath,
    workspaceName: workspaceFolder.name,
    sourcePath,
  });
  validateCropBoxForTarget(crop.cropBox, crop.target, crop.pageGeometry);

  await runConfiguredPdfConversion({
    operationName: 'crop-pdf-configure',
    messages: {
      progressTitle: userMessage('message.progress.cropPdf.title', 1),
      prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
      successMessage: (count) => userMessage('message.cropPdf.success', count),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage('message.cropPdf.cancelled'),
      failedMessage: (reason) => userMessage('message.cropPdf.failed', reason),
    },
    outputChannel,
    panel,
    signal,
    run: async (runtime) =>
      cropPdfWithConfiguredBox({
        job: {
          sourcePath,
          workspacePath: workspaceFolder.uri.fsPath,
          outputPath,
          cropBox: crop.cropBox,
          target: crop.target,
        },
        runtime,
      }),
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

function cropPdfLabels(): CropPdfLabels {
  return {
    header: {
      title: localeMap('webview.cropPdf.title'),
      description: localeMap('webview.cropPdf.description'),
      pageLabel: localeMap('webview.cropPdf.pageLabel'),
      pages: localeMap('webview.cropPdf.pages'),
    },
    preview: {
      title: localeMap('webview.cropPdf.preview'),
      ariaLabel: localeMap('webview.cropPdf.previewAriaLabel'),
      zoomLabel: localeMap('webview.cropPdf.previewZoom'),
      zoomOut: localeMap('webview.cropPdf.zoomOut'),
      zoomIn: localeMap('webview.cropPdf.zoomIn'),
      renderError: localeMap('webview.cropPdf.previewRenderError'),
      applyError: localeMap('webview.cropPdf.previewApplyError'),
    },
    cropBox: {
      settingsLabel: localeMap('webview.cropPdf.cropSettings'),
      title: localeMap('webview.cropPdf.cropBox'),
      left: localeMap('webview.cropPdf.left'),
      bottom: localeMap('webview.cropPdf.bottom'),
      right: localeMap('webview.cropPdf.right'),
      top: localeMap('webview.cropPdf.top'),
      currentPageSize: localeMap('webview.cropPdf.currentPageSize'),
    },
    targetPages: {
      applyTo: localeMap('webview.cropPdf.applyTo'),
      all: localeMap('webview.cropPdf.allPages'),
      pages: localeMap('webview.cropPdf.pages'),
      inputLabel: localeMap('webview.cropPdf.pagesInput'),
      placeholder: localeMap('webview.cropPdf.pagesPlaceholder'),
    },
    validation: {
      cropBoxNumber: localeMap('webview.cropPdf.cropBoxNumberError'),
      cropBoxSize: localeMap('webview.cropPdf.cropBoxSizeError'),
      pagesRequired: localeMap('webview.cropPdf.pagesRequiredError'),
      pageWholeNumber: localeMap('webview.cropPdf.pageWholeNumberError'),
      pageOutOfRange: localeMap('webview.cropPdf.pageOutOfRangeError'),
    },
    actions: {
      apply: localeMap('webview.cropPdf.apply'),
      processing: localeMap('webview.cropPdf.processing'),
      cancel: localeMap('webview.cropPdf.cancel'),
    },
  };
}
