import path from 'node:path';

import * as vscode from 'vscode';

/** Resolves the selected URIs, deduplicating by their string form. */
export function resolveSelectedUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
  let candidates: vscode.Uri[] = [];
  if (uris !== undefined && uris.length > 0) {
    candidates = uris;
  } else if (uri !== undefined) {
    candidates = [uri];
  }
  return [...new Map(candidates.map((candidate) => [candidate.toString(), candidate])).values()];
}

/** Asserts that the source URI is a local file. */
export function assertLocalFileUri(sourceUri: vscode.Uri): void {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local files are supported: ${sourceUri.toString()}`);
  }
}

/**
 * Resolves the single PDF selected by a Configure command, validating that it
 * is a local file with a `.pdf` extension.
 */
export function resolveSingleConfiguredPdfUri(sourceUris: vscode.Uri[], commandName: string): vscode.Uri {
  if (sourceUris.length !== 1) {
    throw new Error(`${commandName} requires exactly one PDF file.`);
  }

  const [inputUri] = sourceUris;
  if (!inputUri) {
    throw new Error(`${commandName} requires exactly one PDF file.`);
  }

  if (inputUri.scheme !== 'file') {
    throw new Error(`${commandName} supports only local file URI.`);
  }

  if (path.extname(inputUri.fsPath).toLowerCase() !== '.pdf') {
    throw new Error(`${commandName} supports only PDF files.`);
  }

  return inputUri;
}

/** Builds the webview URI for a shared asset subdirectory (pdf.js resources). */
export function toWebviewDirectoryUri(webview: vscode.Webview, appRoot: vscode.Uri, directoryName: string): string {
  return `${webview.asWebviewUri(vscode.Uri.joinPath(appRoot, directoryName)).toString()}/`;
}
