import path from 'node:path';

import * as vscode from 'vscode';

import {
  splitPdfProtocol,
  type SplitPdfHostToWebview,
  type SplitPdfPageGroupRow,
} from '@graphics-workbench/vscode-protocol/split-pdf-protocol';
import type { PdfPreviewSettings } from '@graphics-workbench/vscode-protocol/pdf-preview-protocol';
import { assertPageTemplateForSplitOutput, resolvePdfOutputPath } from '@graphics-workbench/core/output';
import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { localeCatalog, localeMap } from '../../locale_map.js';
import {
  inspectPdfSummary,
  splitPdfAllPages,
  splitPdfByPageGroups,
  type SplitPdfInput,
} from '@graphics-workbench/core/pdf';
import { assertWritablePathInWorkspace } from '@graphics-workbench/core/security';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { runSinglePdfConfigureCommand } from '../lifecycle/run_single_pdf_configure.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import {
  isAbortError,
  type CommittedConversionOutput,
  type ConversionExecutionContext,
} from '@graphics-workbench/core/runtime';
import { createPdfJsResources } from '../../presentation/webview/pdfjs_assets.js';

function readSplitPdfTemplate(dependencies: CommandDependencies): string {
  return dependencies.getConfiguration().outputPath.split.pdf();
}

export async function splitPdfAllPagesCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const { outputChannel } = dependencies;
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
  const { outputChannel } = dependencies;

  try {
    await runSinglePdfConfigureCommand({
      context,
      sourceUris,
      dependencies,
      commandId: 'splitPdf.configure',
      pageId: 'split-pdf',
      panelId: 'graphics-workbench.splitPdf.configure',
      panelTitle: localeMap('submenu.splitPdf'),
      protocol: splitPdfProtocol,
      operationName: 'split-pdf-configure',
      messages: {
        progressTitle: userMessage('message.progress.splitPdf.title', 1),
        prepareMessage: userMessage('message.progress.preparePdfSplit'),
        successMessage: (count) => userMessage('message.splitPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.splitPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.splitPdf.failed', reason),
      },
      prepare: async ({ inputUri, workspaceFolder, signal, report }) => {
        report(userMessage('message.progress.analyzingPdf'));
        const { pageCount } = await inspectPdfSummary(inputUri.fsPath, signal);

        if (pageCount === 0) {
          throw new Error(`PDF has no pages: ${inputUri.fsPath}`);
        }

        const outputTemplate = readSplitPdfTemplate(dependencies);

        if (!outputTemplate.includes('${page}')) {
          throw new Error('outputPath.split.pdf must contain ${page} for splitPdf.configure.');
        }

        return {
          pageCount,
          outputTemplate,
          outputPathTemplate: createOutputPathPreviewTemplate(outputTemplate, inputUri, workspaceFolder),
        };
      },
      buildInitPayload: ({ panel, pdfJsAssetsRoot, inputUri, prepared, configuration }) =>
        buildSplitPdfInitMessage({
          panel,
          pdfJsAssetsRoot,
          inputUri,
          pageCount: prepared.pageCount,
          outputPathTemplate: prepared.outputPathTemplate,
          preview: readPdfPreviewSettings(configuration),
        }),
      apply: async (payload, { inputUri, workspaceFolder, prepared, runtime }) =>
        applyConfiguredSplit({
          inputUri,
          workspaceFolder,
          outputTemplate: prepared.outputTemplate,
          pageCount: prepared.pageCount,
          rows: payload.rows,
          runtime,
        }),
      onPreviewLoadFailed: (message, channel) => {
        if (message.type === 'previewLoadFailed') {
          channel?.appendLine(`[split-pdf-configure] preview failure: ${message.payload.message}`);
        }
      },
    });
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
    labels: localeCatalog(),
  };
}

async function applyConfiguredSplit(params: {
  inputUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  outputTemplate: string;
  pageCount: number;
  rows: SplitPdfPageGroupRow[];
  runtime: ConversionExecutionContext;
}): Promise<CommittedConversionOutput[]> {
  const { inputUri, workspaceFolder, outputTemplate, pageCount, rows, runtime } = params;

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

  return splitPdfByPageGroups({
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
