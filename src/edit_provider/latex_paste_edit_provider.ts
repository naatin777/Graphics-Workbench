import path from 'node:path';

import * as vscode from 'vscode';

import { getExtensionConfiguration } from '../config/extension_configuration.js';
import type { GetConfiguration } from '../generated/extension_manifest.js';
import { withCancellationSignal } from '../commands/lifecycle/progress_cancellation.js';
import { resolveOutputConflicts } from '../commands/lifecycle/safe_mode.js';
import { recordConversionForUndo } from '../commands/lifecycle/undo_last_conversion.js';
import { userMessage } from '../commands/shared/user_messages.js';
import { isAbortError } from '../shared/error.js';
import { resolveOutputPath } from '../config/output/resolve_output_path.js';
import { localeMap } from '../locale_map.js';
import type {
  CommittedConversionOutput,
  OutputConflictDecision,
} from '../operations/lifecycle/commit_conversion_outputs.js';
import type { LineOutputChannel } from '../operations/external_tools/external_tool_ascii_scratch.js';
import {
  cleanupClipboardSourceArtifact,
  saveClipboardImage,
  type ClipboardImageData,
  type ClipboardPasteKind,
} from '../operations/input/save_clipboard_image.js';

import { getImageTemplates, renderTemplate, type TemplateContext } from './latex_template.js';
import type { InsertionFormat } from './insertion_format.js';
import { escapeLatex } from './latex_escape.js';

const clipboardImageTypes = [
  { mime: 'image/png', ext: 'png' },
  { mime: 'image/jpeg', ext: 'jpeg' },
] as const;

type PasteKind = ClipboardPasteKind;

interface PasteQuickPickItem extends vscode.QuickPickItem {
  pasteKind: PasteKind;
}

export interface LatexPasteEditProviderOptions {
  format?: InsertionFormat;
  getConfiguration?: GetConfiguration;
  resolveOutputConflicts?: (conflicts: string[]) => Promise<OutputConflictDecision>;
  recordConversionForUndo?: (outputs: CommittedConversionOutput[]) => Promise<string>;
  outputChannel?: LineOutputChannel;
}

export class LatexPasteEditProvider implements vscode.DocumentPasteEditProvider {
  private readonly format: InsertionFormat;
  private readonly resolveConflicts: (conflicts: string[]) => Promise<OutputConflictDecision>;
  private readonly getConfiguration: GetConfiguration;
  private readonly rememberConversion: (outputs: CommittedConversionOutput[]) => Promise<string>;
  private readonly outputChannel: LineOutputChannel | undefined;

  constructor(options: LatexPasteEditProviderOptions = {}) {
    this.format = options.format ?? 'latex';
    this.getConfiguration = options.getConfiguration ?? getExtensionConfiguration;
    this.resolveConflicts = options.resolveOutputConflicts ?? resolveOutputConflicts;
    this.outputChannel = options.outputChannel;
    this.rememberConversion =
      options.recordConversionForUndo ??
      (async (outputs): Promise<string> => recordConversionForUndo(outputs, this.outputChannel));
  }

  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    const data = await readClipboardImageData(dataTransfer);

    if (!data || token.isCancellationRequested) {
      return undefined;
    }

    try {
      return await withCancellationSignal(token, async (signal) => {
        const pasteAsPdfLabel = localeMap('pasteAsPdfLabel');
        const pasteAsImageLabel = localeMap('pasteAsImageLabel');
        const pickedItem = await vscode.window.showQuickPick<PasteQuickPickItem>([
          {
            label: pasteAsPdfLabel,
            detail: localeMap('pasteAsPdfDetail'),
            description: `(${localeMap('builtIn')})`,
            pasteKind: 'pdf',
          },
          {
            label: pasteAsImageLabel,
            detail: localeMap('pasteAsImageDetail'),
            description: `(${localeMap('builtIn')})`,
            pasteKind: 'image',
          },
        ]);

        signal.throwIfAborted();

        if (!pickedItem) {
          // oxlint-disable-next-line unicorn/no-useless-undefined -- VS Code paste provider uses undefined for no edit.
          return undefined;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

        if (!workspaceFolder) {
          // oxlint-disable-next-line unicorn/no-useless-undefined -- VS Code paste provider uses undefined for no edit.
          return undefined;
        }

        const configuration = this.getConfiguration();
        const outputPathClipboardImage = configuration.outputPath.clipboardImage();
        const defaultOutputPath = resolveOutputPath(outputPathClipboardImage, {
          workspacePath: workspaceFolder.uri.fsPath,
          workspaceName: workspaceFolder.name,
          sourcePath: document.uri.fsPath,
        });
        const inputOutputPath = await vscode.window.showInputBox(
          {
            title: localeMap('pasteOutputPathTitle'),
            prompt: localeMap('pasteOutputPathPrompt'),
            value: defaultOutputPath,
            validateInput: (value) => validateOutputBasePath(value, workspaceFolder.uri.fsPath),
          },
          token,
        );

        signal.throwIfAborted();

        if (inputOutputPath === undefined || inputOutputPath === '') {
          // oxlint-disable-next-line unicorn/no-useless-undefined -- VS Code paste provider uses undefined for no edit.
          return undefined;
        }

        const workspacePath = workspaceFolder.uri.fsPath;
        const outputPath = resolveUserOutputBasePath(inputOutputPath, workspacePath);
        let undoRecorded = false;
        const saved = await saveClipboardImage(
          {
            data,
            kind: pickedItem.pasteKind,
            outputBasePath: outputPath,
            workspacePath,
            maxInputPixels: configuration.raster.maxInputPixels(),
          },
          {
            signal,
            resolveConflicts: this.resolveConflicts,
            ...(this.outputChannel !== undefined && { outputChannel: this.outputChannel }),
          },
        );

        try {
          try {
            await this.rememberConversion(saved.outputs);
            undoRecorded = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await vscode.window.showWarningMessage(userMessage('message.clipboardPaste.undoUnavailable', message));
          }

          signal.throwIfAborted();
          const outputFilePath = saved.outputs[0]?.outputPath;

          if (outputFilePath === undefined || outputFilePath === '') {
            throw new Error('Clipboard paste did not produce an output file.');
          }

          const relativeFilePath = path.relative(path.dirname(document.uri.fsPath), outputFilePath);
          const basename = path.basename(outputFilePath, path.extname(outputFilePath));
          const snippet = this.createSingleFileSnippet(basename, relativeFilePath);

          return [new vscode.DocumentPasteEdit(snippet, pickedItem.label, vscode.DocumentDropOrPasteEditKind.Empty)];
        } finally {
          await cleanupClipboardSourceArtifact(
            saved,
            undoRecorded,
            this.outputChannel === undefined ? undefined : { outputChannel: this.outputChannel },
          );
        }
      });
    } catch (error) {
      if (!isAbortError(error)) {
        throw error instanceof Error ? error : new Error(String(error));
      }

      this.outputChannel?.appendLine('[clipboard-paste] cancellation requested');
      return undefined;
    }
  }

  createSingleFileSnippet(fileName: string, relativeFilePath: string): vscode.SnippetString {
    const templates = getImageTemplates(this.format);
    const normalizedRelativeFilePath = normalizeRelativePath(relativeFilePath);
    const ext = path.extname(normalizedRelativeFilePath).toLowerCase().replace('.', '');
    const ctx: TemplateContext = {
      path: normalizedRelativeFilePath,
      // LaTeXはファイル名をエスケープする（複数dropと同一の扱い）。
      name: this.format === 'latex' ? escapeLatex(fileName) : fileName,
      ext,
      dir: path.dirname(normalizedRelativeFilePath) || '.',
    };

    const snippet = new vscode.SnippetString();
    if (templates.length === 1) {
      snippet.appendText(renderTemplate(templates[0] ?? '', ctx));
      return snippet;
    }

    snippet.appendChoice(
      templates.map((t) => renderTemplate(t, ctx)),
      1,
    );
    return snippet;
  }
}

async function readClipboardImageData(dataTransfer: vscode.DataTransfer): Promise<ClipboardImageData | undefined> {
  for (const type of clipboardImageTypes) {
    const file = dataTransfer.get(type.mime)?.asFile();
    const data = await file?.data();

    if (data) {
      return { type, buffer: Buffer.from(data) };
    }
  }

  return undefined;
}

function resolveUserOutputBasePath(value: string, workspacePath: string): string {
  const trimmedValue = value.trim();
  return path.isAbsolute(trimmedValue) ? path.normalize(trimmedValue) : path.resolve(workspacePath, trimmedValue);
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(/[\\/]+/).join('/');
}

function validateOutputBasePath(value: string, workspacePath: string): string | undefined {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return localeMap('pasteOutputPathEmpty');
  }

  const outputPath = resolveUserOutputBasePath(trimmedValue, workspacePath);
  const relativePath = path.relative(workspacePath, outputPath);

  if (relativePath === '..' || path.isAbsolute(relativePath) || relativePath.startsWith(`..${path.sep}`)) {
    return localeMap('pasteOutputPathOutsideWorkspace');
  }

  return undefined;
}
