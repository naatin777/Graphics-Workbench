import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import {
  type CropBox,
  type CropConfigureHostToWebview,
  type CropPdfLabels,
  type CropTarget,
  isCropConfigureMessage,
} from '../../application/protocols/crop_pdf_protocol.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { localeMap } from '../../locale_map.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { cropPdfWithConfiguredBox } from '../../operations/pdf/crop_pdf_configure.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo, UNDO_LAST_CONVERSION_COMMAND } from '../lifecycle/undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError } from '../shared/command_utils.js';

export const CROP_PDF_CONFIGURE_COMMAND = 'graphics-workbench.cropPdf.configure';

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

  const pdf = await PDFDocument.load(await readFile(inputUri.fsPath));
  const firstPage = pdf.getPages()[0];
  const firstPageMediaBox = firstPage?.getMediaBox();
  const outputTemplate = getCommandConfiguration(dependencies).outputPath.cropPdf();
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
      fileName: path.basename(inputUri.fsPath),
      pageCount: pdf.getPageCount(),
      initialPage: 1,
      width: firstPageMediaBox?.width ?? 0,
      height: firstPageMediaBox?.height ?? 0,
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
    void (async (): Promise<void> => {
      try {
        await applyConfiguredCrop({
          inputUri,
          workspaceFolder,
          outputTemplate,
          cropBox: message.payload.cropBox,
          target: message.payload.target,
          panel,
          ...(outputChannel !== undefined && { outputChannel }),
        });
      } finally {
        isApplying = false;
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
  cropBox: CropBox;
  target: CropTarget;
  panel: vscode.WebviewPanel;
  outputChannel?: LineOutputChannel;
}): Promise<void> {
  try {
    const { inputUri, workspaceFolder, outputTemplate, cropBox, target, panel, outputChannel } = params;
    const sourcePath = inputUri.fsPath;
    const outputPath = resolveOutputPath(outputTemplate, {
      workspacePath: workspaceFolder.uri.fsPath,
      workspaceName: workspaceFolder.name,
      sourcePath,
    });

    const outputs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: userMessage('message.progress.cropPdf.title', 1),
        cancellable: true,
      },
      async (progress, token) =>
        withCancellationSignal(token, async (signal) => {
          progress.report({ message: userMessage('message.progress.prepareConversion', 'PDF') });
          const runtime: ConversionExecutionContext = {
            signal,
            ...(outputChannel !== undefined && { outputChannel }),
            resolveConflicts: resolveOutputConflicts,
          };
          return cropPdfWithConfiguredBox({
            job: {
              sourcePath,
              workspacePath: workspaceFolder.uri.fsPath,
              outputPath,
              cropBox,
              target,
            },
            runtime,
          });
        }),
    );

    const successMessage = userMessage('message.cropPdf.success', outputs.length);
    let undoId: string;

    try {
      undoId = await recordConversionForUndo(outputs, outputChannel);
    } catch (error) {
      panel.dispose();
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showWarningMessage(userMessage('message.undoUnavailable', successMessage, message));
      return;
    }

    const undoAction = userMessage('message.action.undo');
    panel.dispose();
    const selectedAction = await vscode.window.showInformationMessage(successMessage, undoAction);

    if (selectedAction === undoAction) {
      await vscode.commands.executeCommand(UNDO_LAST_CONVERSION_COMMAND, undoId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.outputChannel?.appendLine(`[crop-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.cropPdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.cropPdf.failed', message));
  }
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
      cancel: localeMap('webview.cropPdf.cancel'),
    },
  };
}
