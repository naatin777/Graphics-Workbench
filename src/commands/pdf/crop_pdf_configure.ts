import path from 'node:path';
import * as vscode from 'vscode';

import {
  type CropBox,
  type CropConfigureHostToWebview,
  type CropPdfLabels,
  type PdfPageGeometry,
  type CropTarget,
  isCropConfigureMessage,
} from '../../application/protocols/crop_pdf_protocol.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { OperationCancelledError } from '../../operations/lifecycle/operation_cancelled_error.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { cropPdfWithConfiguredBox } from '../../operations/pdf/crop_pdf_configure.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { inspectCropPdfMetadata } from '../../operations/pdf/run_crop_pdf_metadata.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { createProgressReporters } from '../lifecycle/progress_reporting.js';
import { confirmLargeOperation } from '../lifecycle/large_operation_warning.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo } from '../lifecycle/undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError } from '../shared/command_utils.js';

export async function cropPdfConfigureCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    await runCropPdfConfigureCommand(context, uri, uris, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[crop-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.cropPdf.cancelled'));
      return;
    }
    await vscode.window.showErrorMessage(userMessage('message.cropPdf.failed', message));
  }
}

async function runCropPdfConfigureCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  const inputUri = resolveSinglePdfUri(uri, uris);
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
        signal.throwIfAborted();
        progress.report({ message: userMessage('message.progress.prepareConversion', 'PDF') });
        signal.throwIfAborted();
        return inspectCropPdfMetadata(inputUri.fsPath, signal);
      }),
  );
  const configuration = getCommandConfiguration(dependencies);
  const outputTemplate = configuration.outputPath.cropPdf();
  const initMessage: CropConfigureHostToWebview = {
    type: 'init',
    payload: {
      pdfSrc: '',
      resources: {
        workerSrc: '',
        cMapUrl: '',
        standardFontDataUrl: '',
        wasmUrl: '',
      },
      preview: readPdfPreviewSettings(configuration),
      fileName: path.basename(inputUri.fsPath),
      pageCount: pdf.pageCount,
      initialPage: 1,
      pageGeometry: pdf.pages,
      initialCropBox: initialCropBoxForPages(pdf.pages),
      labels: cropPdfLabels(),
    },
  };
  const panel = vscode.window.createWebviewPanel(
    'graphics-workbench.cropPdf.configure',
    `Crop PDF: ${path.basename(inputUri.fsPath)}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'crop_pdf'),
        vscode.Uri.file(path.dirname(inputUri.fsPath)),
      ],
    },
  );
  let isApplying = false;
  let operationState: 'idle' | 'running' | 'completed' = 'idle';
  const operationController = new AbortController();
  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (operationState === 'running') {
        operationController.abort(
          new OperationCancelledError('Crop Configure was cancelled during extension shutdown.'),
        );
      }
    }),
  );

  panel.webview.html = getWebviewHtml({
    webview: panel.webview,
    extensionUri: context.extensionUri,
    title: 'Crop PDF',
    appName: 'crop_pdf',
    locale: vscode.env.language,
  });
  initMessage.payload.pdfSrc = panel.webview.asWebviewUri(inputUri).toString();
  initMessage.payload.resources.workerSrc = panel.webview
    .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'crop_pdf', 'pdf.worker.mjs'))
    .toString();
  initMessage.payload.resources.cMapUrl = toWebviewDirectoryUri(panel.webview, context.extensionUri, 'cmaps');
  initMessage.payload.resources.standardFontDataUrl = toWebviewDirectoryUri(
    panel.webview,
    context.extensionUri,
    'standard_fonts',
  );
  initMessage.payload.resources.wasmUrl = toWebviewDirectoryUri(panel.webview, context.extensionUri, 'wasm');

  panel.onDidDispose(() => {
    if (operationState === 'running') {
      operationController.abort(new OperationCancelledError('Crop Configure panel was closed.'));
    }
  });

  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isCropConfigureMessage(message)) {
      return;
    }

    if (message.type === 'ready') {
      // VS Code Webview.postMessage has no browser targetOrigin parameter.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      void panel.webview.postMessage(initMessage);
      return;
    }

    if (message.type === 'cancel') {
      if (operationState === 'running') {
        operationController.abort(new OperationCancelledError('Crop Configure was cancelled.'));
      }
      panel.dispose();
      return;
    }

    if (message.type === 'previewLoadFailed') {
      outputChannel?.appendLine(`[crop-pdf-configure] preview failure: ${message.payload.message}`);
      void vscode.window.showErrorMessage(message.payload.message);
      return;
    }

    if (isApplying) {
      return;
    }

    isApplying = true;
    operationState = 'running';
    void (async (): Promise<void> => {
      try {
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
          operationSignal: operationController.signal,
          onCompleted: () => {
            operationState = 'completed';
          },
          ...(outputChannel !== undefined && { outputChannel }),
        });
      } finally {
        isApplying = false;
        operationState = 'completed';
      }
    })();
  });
}

function toWebviewDirectoryUri(webview: vscode.Webview, extensionUri: vscode.Uri, directoryName: string): string {
  const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'crop_pdf', directoryName));

  return `${uri.toString()}/`;
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
  operationSignal: AbortSignal;
  onCompleted: () => void;
  outputChannel?: LineOutputChannel;
}): Promise<void> {
  try {
    const { inputUri, workspaceFolder, outputTemplate, crop, panel, operationSignal, onCompleted, outputChannel } =
      params;
    const sourcePath = inputUri.fsPath;
    const outputPath = resolveOutputPath(outputTemplate, {
      workspacePath: workspaceFolder.uri.fsPath,
      workspaceName: workspaceFolder.name,
      sourcePath,
    });
    validateCropBoxForTarget(crop.cropBox, crop.target, crop.pageGeometry);

    const outputs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: userMessage('message.progress.cropPdf.title', 1),
        cancellable: true,
      },
      async (progress, token) =>
        withCancellationSignal(
          token,
          async (signal) => {
            progress.report({ message: userMessage('message.progress.prepareConversion', 'PDF') });
            await confirmLargeOperation({
              sourcePaths: [sourcePath],
              pdfPageCount: crop.pageGeometry.length,
              signal,
            });
            const runtime: ConversionExecutionContext = {
              signal,
              ...createProgressReporters(progress),
              ...(outputChannel !== undefined && { outputChannel }),
              resolveConflicts: resolveOutputConflicts,
            };
            return cropPdfWithConfiguredBox({
              job: {
                sourcePath,
                workspacePath: workspaceFolder.uri.fsPath,
                outputPath,
                cropBox: crop.cropBox,
                target: crop.target,
              },
              runtime,
            });
          },
          operationSignal,
        ),
    );

    const successMessage = userMessage('message.cropPdf.success', outputs.length);
    let undoId: string;

    try {
      undoId = await recordConversionForUndo(outputs, outputChannel);
    } catch (error) {
      onCompleted();
      panel.dispose();
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showWarningMessage(userMessage('message.undoUnavailable', successMessage, message));
      return;
    }

    const undoAction = userMessage('message.action.undo');
    onCompleted();
    panel.dispose();
    const selectedAction = await vscode.window.showInformationMessage(successMessage, undoAction);

    if (selectedAction === undoAction) {
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion', undoId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.outputChannel?.appendLine(`[crop-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.cropPdf.cancelled'));
      return;
    }

    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Webview.postMessage has no targetOrigin parameter.
    void params.panel.webview.postMessage({ type: 'error', payload: { message } });
    await vscode.window.showErrorMessage(userMessage('message.cropPdf.failed', message));
  }
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
  const firstPage = pageGeometry[0];
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

function resolveSinglePdfUri(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri {
  let candidates: vscode.Uri[] = [];
  if (uris !== undefined && uris.length > 0) {
    candidates = uris;
  } else if (uri !== undefined) {
    candidates = [uri];
  }

  if (candidates.length !== 1) {
    throw new Error('cropPdf.configure requires exactly one PDF file.');
  }

  const inputUri = candidates[0];

  if (!inputUri) {
    throw new Error('cropPdf.configure requires exactly one PDF file.');
  }

  if (inputUri.scheme !== 'file') {
    throw new Error('cropPdf.configure supports only local file URI.');
  }

  if (path.extname(inputUri.fsPath).toLowerCase() !== '.pdf') {
    throw new Error('cropPdf.configure supports only PDF files.');
  }

  return inputUri;
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
      description: localeMap('webview.cropPdf.previewDescription'),
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
      description: localeMap('webview.cropPdf.cropBoxDescription'),
      left: localeMap('webview.cropPdf.left'),
      bottom: localeMap('webview.cropPdf.bottom'),
      right: localeMap('webview.cropPdf.right'),
      top: localeMap('webview.cropPdf.top'),
      currentPageSize: localeMap('webview.cropPdf.currentPageSize'),
    },
    targetPages: {
      title: localeMap('webview.cropPdf.targetPages'),
      all: localeMap('webview.cropPdf.allPages'),
      selected: localeMap('webview.cropPdf.selectedPages'),
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
