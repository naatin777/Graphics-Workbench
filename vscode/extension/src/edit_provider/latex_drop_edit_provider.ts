import path from 'node:path';

import * as vscode from 'vscode';

import { localeMap } from '../locale_map.js';

import { escapeLatex, escapeLatexLabel } from '@graphics-workbench/core/table';
import { getPdfTemplates, renderTemplate, type TemplateContext } from './latex_template.js';
import type { InsertionFormat } from './insertion_format.js';

function isCancellationRequested(token: vscode.CancellationToken): boolean {
  return token.isCancellationRequested;
}

export class LatexDropEditProvider implements vscode.DocumentDropEditProvider {
  private readonly format: InsertionFormat;

  constructor(format: InsertionFormat = 'latex') {
    this.format = format;
  }

  async provideDocumentDropEdits(
    document: vscode.TextDocument,
    _position: vscode.Position,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentDropEdit | undefined> {
    if (isCancellationRequested(token) || document.uri.scheme !== 'file') {
      return undefined;
    }

    const dataTransferItem = dataTransfer.get('text/uri-list');

    if (!dataTransferItem) {
      return undefined;
    }

    let uriList: string;

    try {
      uriList = await dataTransferItem.asString();
    } catch {
      return undefined;
    }

    if (isCancellationRequested(token)) {
      return undefined;
    }

    const uris = parsePdfUris(uriList, token);

    if (!uris || uris.length === 0 || isCancellationRequested(token)) {
      return undefined;
    }

    const documentDirname = path.dirname(document.uri.fsPath);
    const fileNames = uris.map((uri) => path.basename(uri.fsPath, path.extname(uri.fsPath)));
    const relativeFilePaths = uris.map((uri) => path.relative(documentDirname, uri.fsPath));

    if (relativeFilePaths.some((relativeFilePath) => path.isAbsolute(relativeFilePath))) {
      return undefined;
    }

    if (isCancellationRequested(token)) {
      return undefined;
    }

    const snippet =
      uris.length === 1
        ? this.createSinglePdfSnippet(fileNames[0] ?? '', relativeFilePaths[0] ?? '')
        : this.createMultiplePdfSnippet(fileNames, relativeFilePaths);

    if (isCancellationRequested(token)) {
      return undefined;
    }

    return new vscode.DocumentDropEdit(snippet, localeMap('insertFigure'));
  }

  createSinglePdfSnippet(fileName: string, relativeFilePath: string): vscode.SnippetString {
    const templates = getPdfTemplates(this.format);
    const normalizedRelativeFilePath = normalizeRelativePath(relativeFilePath);
    const ext = path.extname(normalizedRelativeFilePath).toLowerCase().replace('.', '');
    const ctx: TemplateContext = {
      path: normalizedRelativeFilePath,
      // 単一ファイル挿入でもLaTeXはファイル名をエスケープする。複数dropは
      // escapeLatex/escapeLatexLabelを適用しているため、ここでも揃える。
      name: this.format === 'latex' ? escapeLatex(fileName) : fileName,
      ext,
      dir: path.dirname(normalizedRelativeFilePath) || '.',
    };
    return buildTemplateSnippet(templates, ctx);
  }

  createMultiplePdfSnippet(fileNames: string[], relativeFilePaths: string[]): vscode.SnippetString {
    return this.format === 'latex'
      ? createLatexMultiplePdfSnippet(fileNames, relativeFilePaths)
      : createNonLatexMultiplePdfSnippet(this.format, fileNames, relativeFilePaths);
  }
}

function createLatexMultiplePdfSnippet(fileNames: string[], relativeFilePaths: string[]): vscode.SnippetString {
  const snippet = new vscode.SnippetString();
  let tabstop = 1;

  snippet.appendText('\\begin{figure}[H]\n\t\\centering\n');

  for (const [index, relativeFilePath] of relativeFilePaths.entries()) {
    const name = fileNames[index] ?? '';
    const label = escapeLatexLabel(name);
    const latexRelativeFilePath = normalizeRelativePath(relativeFilePath);

    snippet.appendText('\t\\begin{minipage}');
    snippet.appendChoice(['[t]', '[c]', '[b]'], tabstop++);
    snippet.appendText('{');
    snippet.appendChoice(['{0.45\\linewidth}', '{0.35\\linewidth}'], tabstop++);
    snippet.appendText('}\n');
    snippet.appendText('\t\t\\centering\n');
    snippet.appendText(`\t\t\\includegraphics`);
    snippet.appendChoice(['[width=1.0\\linewidth]', '[width=0.9\\linewidth]'], tabstop++);
    snippet.appendText(`{${latexRelativeFilePath}}\n`);
    snippet.appendText('\t\t\\caption{');
    snippet.appendPlaceholder(escapeLatex(name), tabstop++);
    snippet.appendText('}\n');
    snippet.appendText('\t\t\\label{fig:');
    snippet.appendPlaceholder(label, tabstop++);
    snippet.appendText('}\n');
    snippet.appendText('\t\\end{minipage}\n');

    if (index < relativeFilePaths.length - 1) {
      snippet.appendText('\t');
      snippet.appendChoice(['\\hspace{0.01\\linewidth}', '\\hfill'], tabstop++);
      snippet.appendText('\n');
    }
  }

  snippet.appendText('\\end{figure}');
  return snippet;
}

function createNonLatexMultiplePdfSnippet(
  format: Exclude<InsertionFormat, 'latex'>,
  fileNames: string[],
  relativeFilePaths: string[],
): vscode.SnippetString {
  const snippet = new vscode.SnippetString();

  if (format === 'typst') {
    snippet.appendText('#grid(columns: 2,\n');
  } else {
    snippet.appendText('.row alignment:{spacebetween}\n');
  }

  const entries = relativeFilePaths.map((relativeFilePath, index) =>
    renderSingleTemplate(getPdfTemplates(format), fileNames[index] ?? '', normalizeRelativePath(relativeFilePath)),
  );

  for (const [index, entry] of entries.entries()) {
    if (format === 'typst') {
      snippet.appendText(`  ${entry}`);
      if (index < entries.length - 1) {
        snippet.appendText(',');
      }
      snippet.appendText('\n');
    } else {
      snippet.appendText(`    ${entry}\n`);
    }
  }

  if (format === 'typst') {
    snippet.appendText(')\n');
  } else {
    snippet.appendText('\n');
  }

  return snippet;
}

function renderSingleTemplate(templates: string[], fileName: string, relativeFilePath: string): string {
  const ext = path.extname(relativeFilePath).toLowerCase().replace('.', '');
  const ctx: TemplateContext = {
    path: relativeFilePath,
    name: fileName,
    ext,
    dir: path.dirname(relativeFilePath) || '.',
  };
  return renderTemplate(templates[0] ?? '', ctx);
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(/[\\/]+/).join('/');
}

function buildTemplateSnippet(templates: string[], ctx: TemplateContext): vscode.SnippetString {
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

function parsePdfUris(uriList: string, token: vscode.CancellationToken): vscode.Uri[] | undefined {
  const uniqueUris = new Map<string, vscode.Uri>();

  for (const rawLine of uriList.split(/\r?\n/)) {
    if (isCancellationRequested(token)) {
      return undefined;
    }

    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    let uri: vscode.Uri;

    try {
      uri = vscode.Uri.parse(line, true);
    } catch {
      return undefined;
    }

    if (uri.scheme !== 'file' || path.extname(uri.fsPath).toLowerCase() !== '.pdf') {
      return undefined;
    }

    uniqueUris.set(uri.toString(), uri);
  }

  return [...uniqueUris.values()];
}
