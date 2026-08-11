import path from 'node:path';

import * as vscode from 'vscode';

import {
  isMergePdfWebviewToHostMessage,
  type MergePdfHostToWebview,
  type MergePdfLabels,
  type MergePdfWebviewToHost,
} from '../../shared/protocols/merge_pdf_protocol.js';
import type { PdfPreviewSettings } from '../../shared/protocols/pdf_preview_protocol.js';
import { localeMap } from '../../locale_map.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { mergePdf } from '../../operations/pdf/merge_pdf.js';
import type { LineOutputChannel } from '@graphics-workbench/core/operations/external_tools/external_tool_ascii_scratch.js';
import { assertExistingPathInWorkspace } from '@graphics-workbench/core/security/workspace_path.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { startPdfConfigureSession } from '../lifecycle/pdf_configure_session.js';
import { runConfiguredPdfConversion } from '../lifecycle/run_configured_conversion.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { isAbortError } from '@graphics-workbench/core/shared/error.js';
import {
  createPdfJsResources,
  getPdfJsAssetsRoot,
  getWebviewSharedAssetsRoot,
} from '../../presentation/webview/pdfjs_assets.js';

export async function mergePdfSelectedFilesCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  try {
    assertPdfUris(sourceUris);

    if (sourceUris.length < 2) {
      throw new Error('Select at least two PDF files.');
    }

    const workspace = await requireCommonWorkspace(sourceUris);
    const outputUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(workspace.uri.fsPath, 'merged.pdf')),
      filters: { PDF: ['pdf'] },
      saveLabel: 'Merge',
    });

    if (!outputUri) {
      return;
    }

    await runConversionLifecycle({
      operationName: 'merge-pdf',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.mergePdf.title', sourceUris.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
        successMessage: () => userMessage('message.mergePdf.success', sourceUris.length),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.mergePdf.cancelled'),
        failedMessage: (reason) => userMessage('message.mergePdf.failed', reason),
      },
      run: async (runtime) =>
        mergePdf({
          sourcePaths: sourceUris.map((sourceUri) => sourceUri.fsPath),
          outputPath: outputUri.fsPath,
          workspacePath: workspace.uri.fsPath,
          runtime,
        }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.mergePdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.mergePdf.failed', message));
  }
}

export async function mergePdfConfigureCommand(
  context: Pick<vscode.ExtensionContext, 'extensionUri'>,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;

  try {
    assertPdfUris(sourceUris);

    if (sourceUris.length < 2) {
      throw new Error('Select at least two PDF files.');
    }

    const workspace = await requireCommonWorkspace(sourceUris);
    const configuration = dependencies.getConfiguration();
    const panelTitle = localeMap('submenu.mergePdf');
    const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'merge_pdf');
    const pdfJsAssetsRoot = getPdfJsAssetsRoot(context.extensionUri);
    const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(context.extensionUri);
    const sourceById = new Map(sourceUris.map((sourceUri, index) => [`source-${index + 1}`, sourceUri]));
    startPdfConfigureSession({
      panel: {
        id: 'graphics-workbench.mergePdf.configure',
        title: panelTitle,
        appRoot,
        localResourceRoots: [
          appRoot,
          pdfJsAssetsRoot,
          webviewSharedAssetsRoot,
          ...sourceUris.map((sourceUri) => vscode.Uri.file(path.dirname(sourceUri.fsPath))),
        ],
      },
      webview: {
        title: panelTitle,
        appName: 'merge_pdf',
        extensionUri: context.extensionUri,
        locale: vscode.env.language,
      },
      message: {
        isWebviewToHostMessage: isMergePdfWebviewToHostMessage,
        isApplyMessage: isMergeApplyMessage,
        buildInitMessage: (panel) =>
          buildMergePdfInitMessage({
            panel,
            pdfJsAssetsRoot,
            sourceUris,
            preview: readPdfPreviewSettings(configuration),
          }),
        runApply: async (message, { panel, signal }) => {
          await applyConfiguredMerge({
            sourceById,
            sourceIds: message.payload.sourceIds,
            workspace,
            panel,
            signal,
            outputChannel,
          });
        },
        onPreviewLoadFailed: (message, channel) => {
          if (message.type === 'previewLoadFailed') {
            channel?.appendLine(`[merge-pdf-configure] preview failure: ${message.payload.message}`);
          }
        },
      },
      error: {
        operationName: 'merge-pdf-configure',
        cancelledMessage: userMessage('message.mergePdf.cancelled'),
        failedMessage: (reason) => userMessage('message.mergePdf.failed', reason),
      },
      outputChannel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[merge-pdf-configure] failure: ${message}`);
    await vscode.window.showErrorMessage(userMessage('message.mergePdf.failed', message));
  }
}

function isMergeApplyMessage(
  message: MergePdfWebviewToHost,
): message is Extract<MergePdfWebviewToHost, { type: 'apply' }> {
  return message.type === 'apply';
}

function buildMergePdfInitMessage(params: {
  panel: vscode.WebviewPanel;
  pdfJsAssetsRoot: vscode.Uri;
  sourceUris: vscode.Uri[];
  preview: PdfPreviewSettings;
}): MergePdfHostToWebview {
  const { panel, pdfJsAssetsRoot, sourceUris, preview } = params;

  return {
    type: 'init',
    payload: {
      sources: sourceUris.map((sourceUri, index) => ({
        sourceId: `source-${index + 1}`,
        fileName: path.basename(sourceUri.fsPath),
        pdfSrc: panel.webview.asWebviewUri(sourceUri).toString(),
      })),
      resources: createPdfJsResources(panel.webview, pdfJsAssetsRoot),
      preview,
      labels: buildMergePdfLabels(),
    },
  };
}

async function applyConfiguredMerge(params: {
  sourceById: ReadonlyMap<string, vscode.Uri>;
  sourceIds: string[];
  workspace: vscode.WorkspaceFolder;
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
  outputChannel: LineOutputChannel;
}): Promise<void> {
  const { sourceById, sourceIds, workspace, panel, signal, outputChannel } = params;

  const sourceUris = resolveConfiguredSources(sourceById, sourceIds);
  const outputUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspace.uri.fsPath, 'merged.pdf')),
    filters: { PDF: ['pdf'] },
    saveLabel: 'Merge',
  });

  if (!outputUri) {
    return;
  }

  await runConfiguredPdfConversion({
    operationName: 'merge-pdf-configure',
    messages: {
      progressTitle: userMessage('message.progress.mergePdf.title', sourceUris.length),
      prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
      successMessage: () => userMessage('message.mergePdf.success', sourceUris.length),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage('message.mergePdf.cancelled'),
      failedMessage: (reason) => userMessage('message.mergePdf.failed', reason),
    },
    outputChannel,
    panel,
    signal,
    run: async (runtime) =>
      mergePdf({
        sourcePaths: sourceUris.map((sourceUri) => sourceUri.fsPath),
        outputPath: outputUri.fsPath,
        workspacePath: workspace.uri.fsPath,
        runtime,
      }),
  });
}

function resolveConfiguredSources(sourceById: ReadonlyMap<string, vscode.Uri>, sourceIds: string[]): vscode.Uri[] {
  if (sourceIds.length < 2) {
    throw new Error('Select at least two PDF files.');
  }

  const resolvedUris: vscode.Uri[] = [];
  const seenIds = new Set<string>();

  for (const sourceId of sourceIds) {
    if (seenIds.has(sourceId)) {
      throw new Error('Each PDF can only be selected once.');
    }

    const sourceUri = sourceById.get(sourceId);

    if (!sourceUri) {
      throw new Error('The PDF selection contains an unknown source.');
    }

    seenIds.add(sourceId);
    resolvedUris.push(sourceUri);
  }

  return resolvedUris;
}

function buildMergePdfLabels(): MergePdfLabels {
  return {
    header: {
      title: localeMap('webview.mergePdf.title'),
    },
    sources: {
      list: localeMap('webview.mergePdf.sourceList'),
      count: localeMap('webview.mergePdf.sourceCount'),
    },
    controls: {
      actions: localeMap('webview.mergePdf.actions'),
      dragHandle: localeMap('webview.mergePdf.dragHandle'),
      moveUp: localeMap('webview.mergePdf.moveUp'),
      moveDown: localeMap('webview.mergePdf.moveDown'),
      removeSource: localeMap('webview.mergePdf.removeSource'),
    },
    preview: {
      title: localeMap('webview.mergePdf.preview'),
      ariaLabel: localeMap('webview.mergePdf.previewAriaLabel'),
      loading: localeMap('webview.mergePdf.previewLoading'),
      renderError: localeMap('webview.mergePdf.previewRenderError'),
    },
    actions: {
      apply: localeMap('webview.mergePdf.apply'),
      cancel: localeMap('webview.mergePdf.cancel'),
    },
  };
}

function assertPdfUris(sourceUris: readonly vscode.Uri[]): void {
  for (const candidate of sourceUris) {
    if (candidate.scheme !== 'file') {
      throw new Error(`Only local PDF files are supported: ${candidate.toString()}`);
    }

    if (path.extname(candidate.fsPath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be merged: ${candidate.fsPath}`);
    }
  }
}

async function requireCommonWorkspace(sourceUris: vscode.Uri[]): Promise<vscode.WorkspaceFolder> {
  const [firstSourceUri] = sourceUris;

  if (!firstSourceUri) {
    throw new Error('Select at least two PDF files.');
  }

  const workspace = vscode.workspace.getWorkspaceFolder(firstSourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${firstSourceUri.fsPath}`);
  }

  for (const sourceUri of sourceUris) {
    if (sourceUri.scheme !== 'file') {
      throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
    }

    const sourceWorkspace = vscode.workspace.getWorkspaceFolder(sourceUri);

    if (sourceWorkspace?.uri.toString() !== workspace.uri.toString()) {
      throw new Error('All selected PDF files must be in the same workspace.');
    }
  }

  await Promise.all(
    sourceUris.map(async (sourceUri) => assertExistingPathInWorkspace(sourceUri.fsPath, workspace.uri.fsPath)),
  );

  return workspace;
}
