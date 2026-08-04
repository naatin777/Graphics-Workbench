import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import {
  isRotatePdfWebviewToHostMessage,
  type PdfRotationAngle,
  type RotatePdfHostToWebview,
  type RotatePdfLabels,
} from '../../application/protocols/rotate_pdf_protocol.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { rotatePdfFiles } from '../../operations/pdf/rotate_pdf.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { createProgressReporters } from '../lifecycle/progress_reporting.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo } from '../lifecycle/undo_last_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError } from '../shared/command_utils.js';

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
  const pdf = await PDFDocument.load(await readFile(inputUri.fsPath));
  const pageCount = pdf.getPageCount();

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
  }

  const outputPath = resolveOutputPath(getCommandConfiguration(dependencies).outputPath.rotatePdf(), {
    workspacePath: workspaceFolder.uri.fsPath,
    workspaceName: workspaceFolder.name,
    sourcePath: inputUri.fsPath,
  });

  const panelTitle = localeMap('submenu.rotatePdf');
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'rotate_pdf');
  const panel = vscode.window.createWebviewPanel(
    'graphics-workbench.rotatePdf.configure',
    panelTitle,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [appRoot, vscode.Uri.file(path.dirname(inputUri.fsPath))],
    },
  );
  const initMessage: RotatePdfHostToWebview = {
    type: 'init',
    payload: {
      sourceId: 'source-1',
      fileName: path.basename(inputUri.fsPath),
      pageCount,
      pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
      resources: {
        workerSrc: panel.webview.asWebviewUri(vscode.Uri.joinPath(appRoot, 'pdf.worker.mjs')).toString(),
        cMapUrl: toWebviewDirectoryUri(panel.webview, appRoot, 'cmaps'),
        standardFontDataUrl: toWebviewDirectoryUri(panel.webview, appRoot, 'standard_fonts'),
        wasmUrl: toWebviewDirectoryUri(panel.webview, appRoot, 'wasm'),
      },
      preview: readPdfPreviewSettings(getCommandConfiguration(dependencies)),
      labels: rotatePdfLabels(),
    },
  };

  panel.webview.html = getWebviewHtml({
    webview: panel.webview,
    extensionUri: context.extensionUri,
    title: panelTitle,
    appName: 'rotate_pdf',
    locale: vscode.env.language,
  });

  let isApplying = false;
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isRotatePdfWebviewToHostMessage(message)) {
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
      outputChannel?.appendLine(`[rotate-pdf-configure] preview failure: ${message.payload.message}`);
      return;
    }

    if (isApplying) {
      return;
    }

    isApplying = true;
    void (async (): Promise<void> => {
      try {
        await applyConfiguredRotation({
          inputUri,
          workspacePath: workspaceFolder.uri.fsPath,
          outputPath,
          pageCount,
          angle: message.payload.angle,
          pageIndices: message.payload.pageIndices,
          panel,
          ...(outputChannel !== undefined && { outputChannel }),
        });
      } finally {
        isApplying = false;
      }
    })();
  });
}

async function applyConfiguredRotation(params: {
  inputUri: vscode.Uri;
  workspacePath: string;
  outputPath: string;
  pageCount: number;
  angle: PdfRotationAngle;
  pageIndices: number[];
  panel: vscode.WebviewPanel;
  outputChannel?: LineOutputChannel;
}): Promise<void> {
  const { inputUri, workspacePath, outputPath, pageCount, angle, pageIndices, panel, outputChannel } = params;

  for (const page of pageIndices) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is out of range.`);
    }
  }

  const abortController = new AbortController();
  panel.onDidDispose(() => {
    abortController.abort();
  });

  const outputs = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: userMessage('message.progress.rotatePdf.title', 1),
      cancellable: true,
    },
    async (progress, token) => {
      return withCancellationSignal(token, async (signal) => {
        progress.report({ message: userMessage('message.progress.prepareRotatePdf') });
        const runtime: ConversionExecutionContext = {
          signal,
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
      });
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
