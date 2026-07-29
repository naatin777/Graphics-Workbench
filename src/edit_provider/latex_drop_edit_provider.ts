import path from 'node:path';

import * as vscode from 'vscode';

import { localeMap } from '../locale_map.js';

import { escapeLatex, escapeLatexLabel } from './latex_escape.js';
import { getPdfTemplates, renderTemplate, type TemplateContext } from './latex_template.js';

function isCancellationRequested(token: vscode.CancellationToken): boolean {
  return token.isCancellationRequested;
}

export class LatexDropEditProvider implements vscode.DocumentDropEditProvider {
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

    return new vscode.DocumentDropEdit(snippet, localeMap('insertLatex'));
  }

  createSinglePdfSnippet(fileName: string, relativeFilePath: string): vscode.SnippetString {
    const configuration = vscode.workspace.getConfiguration('latex-graphics-helper');
    const templates = getPdfTemplates(configuration);
    const latexRelativeFilePath = normalizeLatexPath(relativeFilePath);
    const ext = path.extname(latexRelativeFilePath).toLowerCase().replace('.', '');
    const ctx: TemplateContext = {
      path: latexRelativeFilePath,
      name: fileName,
      ext,
      dir: path.dirname(latexRelativeFilePath) || '.',
    };
    return buildTemplateSnippet(templates, ctx);
  }

  createMultiplePdfSnippet(fileNames: string[], relativeFilePaths: string[]): vscode.SnippetString {
    const snippet = new vscode.SnippetString();
    let tabstop = 1;

    snippet.appendText('\\begin{figure}[H]\n\t\\centering\n');

    for (const [index, relativeFilePath] of relativeFilePaths.entries()) {
      const name = fileNames[index] ?? '';
      const label = escapeLatexLabel(name);
      const latexRelativeFilePath = normalizeLatexPath(relativeFilePath);

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
}

function normalizeLatexPath(filePath: string): string {
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
