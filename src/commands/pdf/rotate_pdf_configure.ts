import path from 'node:path';

import * as vscode from 'vscode';

import {
  isRotatePdfWebviewToHostMessage,
  type PdfRotationAngle,
  type RotatePdfHostToWebview,
  type RotatePdfLabels,
  type RotatePdfWebviewToHost,
} from '../../application/protocols/rotate_pdf_protocol.js';
import type { PdfPreviewSettings } from '../../application/protocols/pdf_preview_protocol.js';
import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { rotatePdfFiles } from '../../operations/pdf/rotate_pdf.js';
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
import { getCommandConfiguration, isAbortError } from '../shared/command_utils.js';
import { getPdfJsAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';

export async function rotatePdfConfigureCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;

  try {
    await runRotatePdfConfigureCommand(context, uri, uris, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[rotate-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.rotatePdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.rotatePdf.failed', message));
  }
}

async function runRotatePdfConfigureCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  const inputUri = resolveSinglePdfUri(uri, uris);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(inputUri);

  if (!workspaceFolder) {
    throw new Error('rotatePdf.configure input must be inside the workspace.');
  }

  await assertExistingPathInWorkspace(inputUri.fsPath, workspaceFolder.uri.fsPath);
  const pageCount = await readPdfPageCount(inputUri.fsPath, userMessage('message.progress.rotatePdf.title', 1));

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
  }

  const configuration = getCommandConfiguration(dependencies);
  const outputPath = resolvePdfOutputPath(configuration.outputPath.rotatePdf(), {
    workspacePath: workspaceFolder.uri.fsPath,
    workspaceName: workspaceFolder.name,
    sourcePath: inputUri.fsPath,
  });

  const panelTitle = localeMap('submenu.rotatePdf');
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'rotate_pdf');
  const pdfJsAssetsRoot = getPdfJsAssetsRoot(context.extensionUri);
  startPdfConfigureSession({
    panel: {
      id: 'graphics-workbench.rotatePdf.configure',
      title: panelTitle,
      appRoot,
      localResourceRoots: [appRoot, pdfJsAssetsRoot, vscode.Uri.file(path.dirname(inputUri.fsPath))],
    },
    webview: {
      title: panelTitle,
      appName: 'rotate_pdf',
      extensionUri: context.extensionUri,
      locale: vscode.env.language,
    },
    message: {
      isWebviewToHostMessage: isRotatePdfWebviewToHostMessage,
      isApplyMessage: isRotateApplyMessage,
      buildInitMessage: (panel) =>
        buildRotatePdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pageCount,
          preview: readPdfPreviewSettings(configuration),
        }),
      runApply: async (message, { panel, signal }) => {
        await applyConfiguredRotation({
          inputUri,
          workspacePath: workspaceFolder.uri.fsPath,
          outputPath,
          pageCount,
          angle: message.payload.angle,
          pageIndices: message.payload.pageIndices,
          panel,
          signal,
          ...(outputChannel !== undefined && { outputChannel }),
        });
      },
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[rotate-pdf-configure] preview failure: ${message.payload.message}`);
        }
      },
    },
    error: {
      operationName: 'rotate-pdf-configure',
      cancelledMessage: userMessage('message.rotatePdf.cancelled'),
      failedMessage: (reason) => userMessage('message.rotatePdf.failed', reason),
    },
    ...(outputChannel !== undefined && { outputChannel }),
  });
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
}): RotatePdfHostToWebview {
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
      labels: rotatePdfLabels(),
    },
  };
}

async function applyConfiguredRotation(params: {
  inputUri: vscode.Uri;
  workspacePath: string;
  outputPath: string;
  pageCount: number;
  angle: PdfRotationAngle;
  pageIndices: number[];
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
  outputChannel?: LineOutputChannel;
}): Promise<void> {
  const { inputUri, workspacePath, outputPath, pageCount, angle, pageIndices, panel, signal, outputChannel } = params;

  for (const page of pageIndices) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is out of range.`);
    }
  }

  signal.throwIfAborted();

  const outputs = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: userMessage('message.progress.rotatePdf.title', 1),
      cancellable: true,
    },
    async (progress, token) => {
      return withCancellationSignal(
        token,
        async (applySignal) => {
          progress.report({ message: userMessage('message.progress.prepareRotatePdf') });
          const runtime: ConversionExecutionContext = {
            signal: applySignal,
            ...createProgressReporters(progress),
            ...(outputChannel !== undefined && { outputChannel }),
            resolveConflicts: resolveOutputConflicts,
          };
          return rotatePdfFiles({
            jobs: [
              {
                sourcePath: inputUri.fsPath,
                workspacePath,
                outputPath,
                angle,
                pageIndices: pageIndices.map((page) => page - 1),
              },
            ],
            runtime,
          });
        },
        signal,
      );
    },
  );

  const successMessage = userMessage('message.rotatePdf.success', 1);
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
    throw new Error('rotatePdf.configure requires exactly one PDF file.');
  }

  const [inputUri] = candidates;

  if (!inputUri) {
    throw new Error('rotatePdf.configure requires exactly one PDF file.');
  }

  if (inputUri.scheme !== 'file') {
    throw new Error('rotatePdf.configure supports only local file URI.');
  }

  if (path.extname(inputUri.fsPath).toLowerCase() !== '.pdf') {
    throw new Error('rotatePdf.configure supports only PDF files.');
  }

  return inputUri;
}

function toWebviewDirectoryUri(webview: vscode.Webview, appRoot: vscode.Uri, directoryName: string): string {
  return `${webview.asWebviewUri(vscode.Uri.joinPath(appRoot, directoryName)).toString()}/`;
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
