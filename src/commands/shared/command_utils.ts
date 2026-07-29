import type * as vscode from 'vscode';

import { readDrawioExecutablePath } from '../../config/external_tools/external_tool_paths.js';

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function selectedUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
  let candidates: vscode.Uri[] = [];
  if (uris !== undefined && uris.length > 0) {
    candidates = uris;
  } else if (uri !== undefined) {
    candidates = [uri];
  }
  return [...new Map(candidates.map((candidate) => [candidate.toString(), candidate])).values()];
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readDrawioOptions(configuration: vscode.WorkspaceConfiguration): { drawioPath: string } {
  return { drawioPath: readDrawioExecutablePath(configuration) };
}

export function assertFileScheme(sourceUri: vscode.Uri): void {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local files are supported: ${sourceUri.toString()}`);
  }
}
