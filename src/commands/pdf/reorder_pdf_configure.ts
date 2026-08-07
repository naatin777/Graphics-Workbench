import path from 'node:path';

import * as vscode from 'vscode';

import {
  isReorderPdfWebviewToHostMessage,
  type ReorderPdfHostToWebview,
  type ReorderPdfLabels,
  type ReorderPdfWebviewToHost,
} from '../../application/protocols/reorder_pdf_protocol.js';
import type { PdfPreviewSettings } from '../../application/protocols/pdf_preview_protocol.js';
import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { reorderPdfFiles } from '../../operations/pdf/reorder_pdf.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readPdfPageCount } from '../shared/read_pdf_page_count.js';
import { startPdfConfigureSession } from '../lifecycle/pdf_configure_session.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { createProgressReporters } from '../lifecycle/progress_reporting.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo } from '../lifecycle/undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { isAbortError } from '../../application/error_normalization.js';
import { getPdfJsAssetsRoot, getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';

export async function reorderPdfConfigureCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;

  try {
    await runReorderPdfConfigureCommand(context, uri, uris, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[reorder-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.reorderPdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.reorderPdf.failed', message));
  }
}

async function runReorderPdfConfigureCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  const inputUri = resolveSinglePdfUri(uri, uris);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(inputUri);

  if (!workspaceFolder) {
    throw new Error('reorderPdf.configure input must be inside the workspace.');
  }

  await assertExistingPathInWorkspace(inputUri.fsPath, workspaceFolder.uri.fsPath);
  const pageCount = await readPdfPageCount(inputUri.fsPath, userMessage('message.progress.reorderPdf.title', 1));

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
  }

  const configuration = configureCommandRuntime(dependencies);
  const outputPath = resolvePdfOutputPath(configuration.outputPath.reorderPdf(), {
    workspacePath: workspaceFolder.uri.fsPath,
    workspaceName: workspaceFolder.name,
    sourcePath: inputUri.fsPath,
  });

  const panelTitle = localeMap('submenu.reorderPdf');
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'reorder_pdf');
  const pdfJsAssetsRoot = getPdfJsAssetsRoot(context.extensionUri);
  const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(context.extensionUri);
  startPdfConfigureSession({
    panel: {
      id: 'graphics-workbench.reorderPdf.configure',
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
      appName: 'reorder_pdf',
      extensionUri: context.extensionUri,
      locale: vscode.env.language,
    },
    message: {
      isWebviewToHostMessage: isReorderPdfWebviewToHostMessage,
      isApplyMessage: isReorderApplyMessage,
      buildInitMessage: (panel) =>
        buildReorderPdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pageCount,
          preview: readPdfPreviewSettings(configuration),
        }),
      runApply: async (message, { panel, signal }) => {
        await applyConfiguredReorder({
          inputUri,
          workspacePath: workspaceFolder.uri.fsPath,
          outputPath,
          pageCount,
          order: message.payload.order,
          panel,
          signal,
          ...(outputChannel !== undefined && { outputChannel }),
        });
      },
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[reorder-pdf-configure] preview failure: ${message.payload.message}`);
        }
      },
    },
    error: {
      operationName: 'reorder-pdf-configure',
      cancelledMessage: userMessage('message.reorderPdf.cancelled'),
      failedMessage: (reason) => userMessage('message.reorderPdf.failed', reason),
    },
    ...(outputChannel !== undefined && { outputChannel }),
  });
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
}): ReorderPdfHostToWebview {
  const { panel, pdfJsAssetsRoot, inputUri, pageCount, preview } = params;

  return {
    type: 'init',
    payload: {
      sourceId: 'source-1',
      fileName: path.basename(inputUri.fsPath),
      pageCount,
      pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
      resources: {
        workerSrc: panel.webview.asWebviewUri(vscode.Uri.joinPath(pdfJsAssetsRoot, 'pdf.worker.mjs')).toString(),
        cMapUrl: toWebviewDirectoryUri(panel.webview, pdfJsAssetsRoot, 'cmaps'),
        standardFontDataUrl: toWebviewDirectoryUri(panel.webview, pdfJsAssetsRoot, 'standard_fonts'),
        wasmUrl: toWebviewDirectoryUri(panel.webview, pdfJsAssetsRoot, 'wasm'),
      },
      preview,
      labels: reorderPdfLabels(),
    },
  };
}

async function applyConfiguredReorder(params: {
  inputUri: vscode.Uri;
  workspacePath: string;
  outputPath: string;
  pageCount: number;
  order: number[];
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
  outputChannel?: LineOutputChannel;
}): Promise<void> {
  const { inputUri, workspacePath, outputPath, pageCount, order, panel, signal, outputChannel } = params;

  if (order.length !== pageCount) {
    throw new Error(`Page order must contain exactly ${pageCount} pages.`);
  }

  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is out of range.`);
    }
  }

  signal.throwIfAborted();

  const outputs = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: userMessage('message.progress.reorderPdf.title', 1),
      cancellable: true,
    },
    async (progress, token) => {
      return withCancellationSignal(
        token,
        async (applySignal) => {
          progress.report({ message: userMessage('message.progress.prepareReorderPdf') });
          const runtime: ConversionExecutionContext = {
            signal: applySignal,
            ...createProgressReporters(progress),
            ...(outputChannel !== undefined && { outputChannel }),
            resolveConflicts: resolveOutputConflicts,
          };
          return reorderPdfFiles({
            jobs: [{ sourcePath: inputUri.fsPath, workspacePath, outputPath, pageOrder: order }],
            runtime,
          });
        },
        signal,
      );
    },
  );

  const successMessage = userMessage('message.reorderPdf.success', 1);
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
    await vscode.commands.executeCommand('graphics-workbench.undoLastConversion', undoId);
  }

  panel.dispose();
}

function resolveSinglePdfUri(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri {
  let candidates: vscode.Uri[] = [];
  if (uris !== undefined && uris.length > 0) {
    candidates = uris;
  } else if (uri !== undefined) {
    candidates = [uri];
  }

  if (candidates.length !== 1) {
    throw new Error('reorderPdf.configure requires exactly one PDF file.');
  }

  const [inputUri] = candidates;

  if (!inputUri) {
    throw new Error('reorderPdf.configure requires exactly one PDF file.');
  }

  if (inputUri.scheme !== 'file') {
    throw new Error('reorderPdf.configure supports only local file URI.');
  }

  if (path.extname(inputUri.fsPath).toLowerCase() !== '.pdf') {
    throw new Error('reorderPdf.configure supports only PDF files.');
  }

  return inputUri;
}

function toWebviewDirectoryUri(webview: vscode.Webview, appRoot: vscode.Uri, directoryName: string): string {
  return `${webview.asWebviewUri(vscode.Uri.joinPath(appRoot, directoryName)).toString()}/`;
}

function reorderPdfLabels(): ReorderPdfLabels {
  return {
    header: {
      title: localeMap('webview.reorderPdf.title'),
      description: localeMap('webview.reorderPdf.description'),
    },
    preview: {
      title: localeMap('webview.reorderPdf.preview'),
      ariaLabel: localeMap('webview.reorderPdf.previewAriaLabel'),
      renderError: localeMap('webview.reorderPdf.previewRenderError'),
      applyError: localeMap('webview.reorderPdf.previewApplyError'),
    },
    order: {
      title: localeMap('webview.reorderPdf.order'),
      moveUp: localeMap('webview.reorderPdf.moveUp'),
      moveDown: localeMap('webview.reorderPdf.moveDown'),
      positionLabel: localeMap('webview.reorderPdf.positionLabel'),
    },
    validation: {
      orderRequired: localeMap('webview.reorderPdf.orderRequiredError'),
      orderInvalid: localeMap('webview.reorderPdf.orderInvalid'),
    },
    actions: {
      apply: localeMap('webview.reorderPdf.apply'),
      cancel: localeMap('webview.reorderPdf.cancel'),
    },
  };
}
