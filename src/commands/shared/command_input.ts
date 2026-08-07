import type * as vscode from 'vscode';

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
