import path from 'node:path';

import * as vscode from 'vscode';

import {
  isRotatePdfWebviewToHostMessage,
  type PdfRotationAngle,
  type RotatePdfHostToWebview,
  type RotatePdfLabels,
  type RotatePdfWebviewToHost,
} from '../../shared/protocols/rotate_pdf_protocol.js';
import type { PdfPreviewSettings } from '../../shared/protocols/pdf_preview_protocol.js';
import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { rotatePdfFiles } from '../../operations/pdf/rotate_pdf.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readPdfPageCount } from '../shared/read_pdf_page_count.js';
import { startPdfConfigureSession } from '../lifecycle/pdf_configure_session.js';
import { runConfiguredPdfConversion } from '../lifecycle/run_configured_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { resolveSingleConfiguredPdfUri } from '../shared/command_input.js';
import { isAbortError } from '../../shared/error.js';
import {
  createPdfJsResources,
  getPdfJsAssetsRoot,
  getWebviewSharedAssetsRoot,
} from '../../presentation/webview/pdfjs_assets.js';

export async function rotatePdfConfigureCommand(
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;

  try {
    await runRotatePdfConfigureCommand(context, sourceUris, dependencies);
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

async function runRotatePdfConfigureCommand(
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  const inputUri = resolveSingleConfiguredPdfUri(sourceUris, 'rotatePdf.configure');
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(inputUri);

  if (!workspaceFolder) {
    throw new Error('rotatePdf.configure input must be inside the workspace.');
  }

  await assertExistingPathInWorkspace(inputUri.fsPath, workspaceFolder.uri.fsPath);
  const pageCount = await readPdfPageCount(inputUri.fsPath, userMessage('message.progress.rotatePdf.title', 1));

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
  }

  const configuration = dependencies.getConfiguration();
  const outputPath = resolvePdfOutputPath(configuration.outputPath.rotatePdf(), {
    workspacePath: workspaceFolder.uri.fsPath,
    workspaceName: workspaceFolder.name,
    sourcePath: inputUri.fsPath,
  });

  const panelTitle = localeMap('submenu.rotatePdf');
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'rotatePdf.configure');
  const pdfJsAssetsRoot = getPdfJsAssetsRoot(context.extensionUri);
  const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(context.extensionUri);
  startPdfConfigureSession({
    panel: {
      id: 'graphics-workbench.rotatePdf.configure',
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
      appName: 'rotatePdf.configure',
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
          outputChannel,
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
    outputChannel,
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
      resources: createPdfJsResources(panel.webview, pdfJsAssetsRoot),
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
  outputChannel: LineOutputChannel;
}): Promise<void> {
  const { inputUri, workspacePath, outputPath, pageCount, angle, pageIndices, panel, signal, outputChannel } = params;

  for (const page of pageIndices) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is out of range.`);
    }
  }

  await runConfiguredPdfConversion({
    operationName: 'rotate-pdf-configure',
    messages: {
      progressTitle: userMessage('message.progress.rotatePdf.title', 1),
      prepareMessage: userMessage('message.progress.prepareRotatePdf'),
      successMessage: (count) => userMessage('message.rotatePdf.success', count),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage('message.rotatePdf.cancelled'),
      failedMessage: (reason) => userMessage('message.rotatePdf.failed', reason),
    },
    outputChannel,
    panel,
    signal,
    run: async (runtime) =>
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
  });
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
