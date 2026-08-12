import path from 'node:path';

import * as vscode from 'vscode';

import {
  splitPdfProtocol,
  type SplitPdfHostToWebview,
  type SplitPdfLabels,
  type SplitPdfPageGroupRow,
  type SplitPdfWebviewToHost,
} from '../../../../protocol/protocols/split_pdf_protocol.js';
import type { PdfPreviewSettings } from '../../../../protocol/protocols/pdf_preview_protocol.js';
import { assertPageTemplateForSplitOutput, resolvePdfOutputPath } from '@graphics-workbench/core/output';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeMap } from '../../locale_map.js';
import { splitPdfAllPages, splitPdfByPageGroups, type SplitPdfInput } from '@graphics-workbench/core/pdf';
import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '@graphics-workbench/core/security';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readPdfPageCount } from '../shared/read_pdf_page_count.js';
import { startPdfConfigureSession } from '../lifecycle/pdf_configure_session.js';
import { runConfiguredPdfConversion } from '../lifecycle/run_configured_conversion.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { isAbortError } from '@graphics-workbench/core/runtime';
import { resolveSingleConfiguredPdfUri } from '../shared/command_input.js';
import {
  createPdfJsResources,
  getPdfJsAssetsRoot,
  getWebviewSharedAssetsRoot,
} from '../../presentation/webview/pdfjs_assets.js';

function readSplitPdfTemplate(dependencies: CommandDependencies): string {
  return dependencies.getConfiguration().outputPath.split.pdf();
}

export async function splitPdfAllPagesCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  try {
    if (sourceUris.length === 0) {
      throw new Error('No PDF files were selected.');
    }

    const outputTemplate = readSplitPdfTemplate(dependencies);
    // 分割コマンドの出力テンプレートは本質的に${page}を持つ必要がある。
    // 欠落すると全ページが同一パスへ衝突し、最後のページだけが残る。
    assertPageTemplateForSplitOutput(outputTemplate, 2);
    const inputs = sourceUris.map((sourceUri) => planSplitPdfInput(sourceUri, outputTemplate));
    await runConversionLifecycle({
      operationName: 'split-pdf',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.splitPdf.title', inputs.length),
        prepareMessage: userMessage('message.progress.preparePdfSplit'),
        successMessage: (count) => userMessage('message.splitPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.splitPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.splitPdf.failed', reason),
      },
      run: async (runtime) => splitPdfAllPages({ inputs, runtime }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.splitPdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.splitPdf.failed', message));
  }
}

function planSplitPdfInput(sourceUri: vscode.Uri, outputTemplate: string): SplitPdfInput {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Only PDF files can be split: ${sourcePath}`);
  }

  return {
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    outputPathForPage: (page) =>
      resolvePdfOutputPath(outputTemplate, {
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
        sourcePath,
        page: page.toString(),
      }),
  };
}

export async function splitPdfConfigureCommand(
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;

  try {
    await runSplitPdfConfigureCommand(context, sourceUris, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[split-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.splitPdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.splitPdf.failed', message));
  }
}

async function runSplitPdfConfigureCommand(
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  const inputUri = resolveSingleConfiguredPdfUri(sourceUris, 'splitPdf.configure');
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(inputUri);

  if (!workspaceFolder) {
    throw new Error('splitPdf.configure input must be inside the workspace.');
  }

  await assertExistingPathInWorkspace(inputUri.fsPath, workspaceFolder.uri.fsPath);
  const pageCount = await readPdfPageCount(inputUri.fsPath, userMessage('message.progress.splitPdf.title', 1));

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
  }

  const outputTemplate = readSplitPdfTemplate(dependencies);

  if (!outputTemplate.includes('${page}')) {
    throw new Error('outputPath.split.pdf must contain ${page} for splitPdf.configure.');
  }

  const outputPathTemplate = createOutputPathPreviewTemplate(outputTemplate, inputUri, workspaceFolder);
  const configuration = dependencies.getConfiguration();
  const panelTitle = localeMap('submenu.splitPdf');
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview');
  const pdfJsAssetsRoot = getPdfJsAssetsRoot(context.extensionUri);
  const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(context.extensionUri);
  startPdfConfigureSession({
    panel: {
      id: 'graphics-workbench.splitPdf.configure',
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
      pageId: 'split-pdf',
      extensionUri: context.extensionUri,
      locale: vscode.env.language,
    },
    protocol: splitPdfProtocol,
    message: {
      isApplyMessage: isSplitApplyMessage,
      buildInitPayload: (panel) =>
        buildSplitPdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pageCount,
          outputPathTemplate,
          preview: readPdfPreviewSettings(configuration),
        }),
      runApply: async (message, { panel, signal, sendError }) => {
        await applyConfiguredSplit({
          inputUri,
          workspaceFolder,
          outputTemplate,
          pageCount,
          rows: message.payload.rows,
          panel,
          signal,
          outputChannel,
          sendError,
        });
      },
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[split-pdf-configure] preview failure: ${message.payload.message}`);
        }
      },
    },
    error: {
      operationName: 'split-pdf-configure',
      cancelledMessage: userMessage('message.splitPdf.cancelled'),
      failedMessage: (reason) => userMessage('message.splitPdf.failed', reason),
    },
    outputChannel,
  });
}

function isSplitApplyMessage(
  message: SplitPdfWebviewToHost,
): message is Extract<SplitPdfWebviewToHost, { type: 'apply' }> {
  return message.type === 'apply';
}

function buildSplitPdfInitMessage(params: {
  panel: vscode.WebviewPanel;
  pdfJsAssetsRoot: vscode.Uri;
  inputUri: vscode.Uri;
  pageCount: number;
  outputPathTemplate: string;
  preview: PdfPreviewSettings;
}): Extract<SplitPdfHostToWebview, { type: 'init' }>['payload'] {
  const { panel, pdfJsAssetsRoot, inputUri, pageCount, outputPathTemplate, preview } = params;

  return {
    sourceId: 'source-1',
    fileName: path.basename(inputUri.fsPath),
    pageCount,
    pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
    outputPathTemplate,
    resources: createPdfJsResources(panel.webview, pdfJsAssetsRoot),
    preview,
    labels: splitPdfLabels(),
  };
}

async function applyConfiguredSplit(params: {
  inputUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  outputTemplate: string;
  pageCount: number;
  rows: SplitPdfPageGroupRow[];
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
  outputChannel: LineOutputChannel;
  sendError: (message: string) => void;
}): Promise<void> {
  const { inputUri, workspaceFolder, outputTemplate, pageCount, rows, panel, signal, outputChannel, sendError } =
    params;

  validateConfiguredRows(rows, pageCount);
  if (!outputTemplate.includes('${page}')) {
    throw new Error('outputPath.split.pdf must contain ${page} for splitPdf.configure.');
  }

  const sourcePath = inputUri.fsPath;
  const workspacePath = workspaceFolder.uri.fsPath;
  const outputContext = {
    workspacePath,
    workspaceName: workspaceFolder.name,
    sourcePath,
  };

  for (const row of rows) {
    const outputPath = resolvePdfOutputPath(outputTemplate, { ...outputContext, page: row.outputName });
    await assertWritablePathInWorkspace(outputPath, workspacePath);
  }

  await runConfiguredPdfConversion({
    operationName: 'split-pdf-configure',
    messages: {
      progressTitle: userMessage('message.progress.splitPdf.title', 1),
      prepareMessage: userMessage('message.progress.preparePdfSplit'),
      successMessage: (count) => userMessage('message.splitPdf.success', count),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage('message.splitPdf.cancelled'),
      failedMessage: (reason) => userMessage('message.splitPdf.failed', reason),
    },
    outputChannel,
    panel,
    signal,
    sendError,
    run: async (runtime) =>
      splitPdfByPageGroups({
        inputs: [
          {
            sourcePath,
            workspacePath,
            pageGroups: rows.map((row) => row.pages),
            outputPathForGroup: (groupIndex): string => {
              const row = rows[groupIndex];

              if (!row) {
                throw new Error(`No output name was supplied for group ${groupIndex}.`);
              }

              return resolvePdfOutputPath(outputTemplate, { ...outputContext, page: row.outputName });
            },
          },
        ],
        runtime,
      }),
  });
}

function validateConfiguredRows(rows: readonly SplitPdfPageGroupRow[], pageCount: number): void {
  if (rows.length === 0) {
    throw new Error('At least one PDF page group is required.');
  }

  const outputNames = new Set<string>();

  for (const [groupIndex, row] of rows.entries()) {
    if (row.pages.length === 0) {
      throw new Error(`Page group ${groupIndex + 1} cannot be empty.`);
    }

    for (const page of row.pages) {
      if (!Number.isInteger(page) || page < 1 || page > pageCount) {
        throw new Error(`Page ${page} in group ${groupIndex + 1} is out of range.`);
      }
    }

    if (row.outputName.trim().length === 0) {
      throw new Error(`Output name for group ${groupIndex + 1} cannot be empty.`);
    }

    if (row.outputName.includes('\u0000') || /[\\/]/.test(row.outputName) || row.outputName.includes('..')) {
      throw new Error(`Output name for group ${groupIndex + 1} must be a file name without path separators or .. .`);
    }

    if (outputNames.has(row.outputName)) {
      throw new Error(`Output name is duplicated: ${row.outputName}`);
    }

    outputNames.add(row.outputName);
  }
}

function createOutputPathPreviewTemplate(
  outputTemplate: string,
  inputUri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): string {
  const marker = '__GRAPHICS_WORKBENCH_OUTPUT_NAME__';
  const outputPath = resolvePdfOutputPath(outputTemplate, {
    workspacePath: workspaceFolder.uri.fsPath,
    workspaceName: workspaceFolder.name,
    sourcePath: inputUri.fsPath,
    page: marker,
  });
  const relativePath = path.relative(workspaceFolder.uri.fsPath, outputPath);

  return relativePath.length > 0 ? relativePath : path.basename(outputPath);
}

function splitPdfLabels(): SplitPdfLabels {
  return {
    header: {
      title: localeMap('webview.splitPdf.title'),
      description: localeMap('webview.splitPdf.description'),
    },
    preview: {
      title: localeMap('webview.splitPdf.preview'),
      ariaLabel: localeMap('webview.splitPdf.previewAriaLabel'),
      renderError: localeMap('webview.splitPdf.previewRenderError'),
      applyError: localeMap('webview.splitPdf.previewApplyError'),
      allPages: localeMap('webview.splitPdf.allPages'),
      focusedPages: localeMap('webview.splitPdf.focusedPages'),
      zoom: localeMap('webview.splitPdf.zoom'),
    },
    groups: {
      title: localeMap('webview.splitPdf.groups'),
      label: localeMap('webview.splitPdf.groupLabel'),
      add: localeMap('webview.splitPdf.addGroup'),
      remove: localeMap('webview.splitPdf.removeGroup'),
      drag: localeMap('webview.splitPdf.dragGroup'),
      outputOrder: localeMap('webview.splitPdf.outputOrder'),
    },
    pages: {
      title: localeMap('webview.splitPdf.pages'),
      label: localeMap('webview.splitPdf.pageLabel'),
      placeholder: localeMap('webview.splitPdf.pagesPlaceholder'),
    },
    output: {
      name: localeMap('webview.splitPdf.outputName'),
      namePlaceholder: localeMap('webview.splitPdf.outputNamePlaceholder'),
      path: localeMap('webview.splitPdf.outputPath'),
    },
    validation: {
      pagesRequired: localeMap('webview.splitPdf.pagesRequiredError'),
      pageWholeNumber: localeMap('webview.splitPdf.pageWholeNumberError'),
      pageOutOfRange: localeMap('webview.splitPdf.pageOutOfRangeError'),
      invalidPages: localeMap('webview.splitPdf.invalidPages'),
      descendingPages: localeMap('webview.splitPdf.descendingPages'),
      outputNameEmpty: localeMap('webview.splitPdf.outputNameEmpty'),
      outputNamePath: localeMap('webview.splitPdf.outputNamePath'),
      outputNameDuplicate: localeMap('webview.splitPdf.outputNameDuplicate'),
    },
    actions: {
      apply: localeMap('webview.splitPdf.apply'),
      cancel: localeMap('webview.splitPdf.cancel'),
      moveUp: localeMap('webview.splitPdf.moveUp'),
      moveDown: localeMap('webview.splitPdf.moveDown'),
    },
  };
}
