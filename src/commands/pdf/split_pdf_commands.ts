import path from 'node:path';

import * as vscode from 'vscode';

import {
  isSplitPdfWebviewToHostMessage,
  type SplitPdfHostToWebview,
  type SplitPdfLabels,
  type SplitPdfPageGroupRow,
  type SplitPdfWebviewToHost,
} from '../../application/protocols/split_pdf_protocol.js';
import type { PdfPreviewSettings } from '../../application/protocols/pdf_preview_protocol.js';
import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { localeMap } from '../../locale_map.js';
import { splitPdfAllPages, splitPdfByPageGroups, type SplitPdfJob } from '../../operations/pdf/split_pdf.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readPdfPageCount } from '../shared/read_pdf_page_count.js';
import { startPdfConfigureSession } from '../lifecycle/pdf_configure_session.js';
import { withCancellationSignal } from '../lifecycle/progress_cancellation.js';
import { createProgressReporters } from '../lifecycle/progress_reporting.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { recordConversionForUndo } from '../lifecycle/undo_last_conversion.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { isAbortError } from '../../application/error_normalization.js';
import { resolveSelectedUris } from '../shared/command_input.js';
import { getPdfJsAssetsRoot, getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';

const defaultSplitPdfTemplate = '${fileDirname}/${fileBasenameNoExtension}/${page}.pdf';

function readSplitPdfTemplate(dependencies?: CommandDependencies): string {
  return resolveOutputPathsTemplate(configureCommandRuntime(dependencies), 'splitPdf', defaultSplitPdfTemplate);
}

export async function splitPdfAllPagesCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = resolveSelectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No PDF files were selected.');
    }

    const outputTemplate = readSplitPdfTemplate(dependencies);
    const jobs = sourceUris.map((sourceUri) => planSplitPdfJob(sourceUri, outputTemplate));
    await runConversionLifecycle({
      operationName: 'split-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.splitPdf.title', jobs.length),
        prepareMessage: userMessage('message.progress.preparePdfSplit'),
        successMessage: (count) => userMessage('message.splitPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.splitPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.splitPdf.failed', reason),
      },
      run: async (runtime) => splitPdfAllPages({ jobs, runtime }),
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

function planSplitPdfJob(sourceUri: vscode.Uri, outputTemplate: string): SplitPdfJob {
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
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;

  try {
    await runSplitPdfConfigureCommand(context, uri, uris, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[split-pdf-configure] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.splitPdf.cancelled'));
      return;
    }

    await vscode.window.showErrorMessage(userMessage('message.splitPdf.failed', message));
  }
}

async function runSplitPdfConfigureCommand(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  const inputUri = resolveSinglePdfUri(uri, uris);
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
    throw new Error('outputPaths.splitPdf must contain ${page} for splitPdf.configure.');
  }

  const outputPathTemplate = createOutputPathPreviewTemplate(outputTemplate, inputUri, workspaceFolder);
  const configuration = configureCommandRuntime(dependencies);
  const panelTitle = localeMap('submenu.splitPdf');
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'split_pdf');
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
      appName: 'split_pdf',
      extensionUri: context.extensionUri,
      locale: vscode.env.language,
    },
    message: {
      isWebviewToHostMessage: isSplitPdfWebviewToHostMessage,
      isApplyMessage: isSplitApplyMessage,
      buildInitMessage: (panel) =>
        buildSplitPdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pageCount,
          outputPathTemplate,
          preview: readPdfPreviewSettings(configuration),
        }),
      runApply: async (message, { panel, signal }) => {
        await applyConfiguredSplit({
          inputUri,
          workspaceFolder,
          outputTemplate,
          pageCount,
          rows: message.payload.rows,
          panel,
          signal,
          ...(outputChannel !== undefined && { outputChannel }),
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
    ...(outputChannel !== undefined && { outputChannel }),
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
}): SplitPdfHostToWebview {
  const { panel, pdfJsAssetsRoot, inputUri, pageCount, outputPathTemplate, preview } = params;

  return {
    type: 'init',
    payload: {
      sourceId: 'source-1',
      fileName: path.basename(inputUri.fsPath),
      pageCount,
      pdfSrc: panel.webview.asWebviewUri(inputUri).toString(),
      outputPathTemplate,
      resources: {
        workerSrc: panel.webview.asWebviewUri(vscode.Uri.joinPath(pdfJsAssetsRoot, 'pdf.worker.mjs')).toString(),
        cMapUrl: toWebviewDirectoryUri(panel.webview, pdfJsAssetsRoot, 'cmaps'),
        standardFontDataUrl: toWebviewDirectoryUri(panel.webview, pdfJsAssetsRoot, 'standard_fonts'),
        wasmUrl: toWebviewDirectoryUri(panel.webview, pdfJsAssetsRoot, 'wasm'),
      },
      preview,
      labels: splitPdfLabels(),
    },
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
  outputChannel?: LineOutputChannel;
}): Promise<void> {
  const { inputUri, workspaceFolder, outputTemplate, pageCount, rows, panel, signal, outputChannel } = params;

  validateConfiguredRows(rows, pageCount);
  if (!outputTemplate.includes('${page}')) {
    throw new Error('outputPath.splitPdf must contain ${page} for splitPdf.configure.');
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

  signal.throwIfAborted();

  const outputs = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: userMessage('message.progress.splitPdf.title', 1),
      cancellable: true,
    },
    async (progress, token) => {
      return withCancellationSignal(
        token,
        async (applySignal) => {
          progress.report({ message: userMessage('message.progress.preparePdfSplit') });
          const runtime: ConversionExecutionContext = {
            signal: applySignal,
            ...createProgressReporters(progress),
            ...(outputChannel !== undefined && { outputChannel }),
            resolveConflicts: resolveOutputConflicts,
          };
          return await splitPdfByPageGroups({
            jobs: [
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
          });
        },
        signal,
      );
    },
  );

  const successMessage = userMessage('message.splitPdf.success', outputs.length);
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
    throw new Error('splitPdf.configure requires exactly one PDF file.');
  }

  const [inputUri] = candidates;

  if (!inputUri) {
    throw new Error('splitPdf.configure requires exactly one PDF file.');
  }

  if (inputUri.scheme !== 'file') {
    throw new Error('splitPdf.configure supports only local file URI.');
  }

  if (path.extname(inputUri.fsPath).toLowerCase() !== '.pdf') {
    throw new Error('splitPdf.configure supports only PDF files.');
  }

  return inputUri;
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

function toWebviewDirectoryUri(webview: vscode.Webview, appRoot: vscode.Uri, directoryName: string): string {
  return `${webview.asWebviewUri(vscode.Uri.joinPath(appRoot, directoryName)).toString()}/`;
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
