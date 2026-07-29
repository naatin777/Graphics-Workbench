import type * as vscode from 'vscode';

import { readDrawioExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { getExtensionConfiguration } from '../../generated-extension-config.js';
import type { Configuration } from '../../generated-extension-meta.js';

import type { CommandDependencies } from './command_dependencies.js';

export { errorMessage, isAbortError } from '../../application/error_utils.js';

export function selectedUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
  let candidates: vscode.Uri[] = [];
  if (uris !== undefined && uris.length > 0) {
    candidates = uris;
  } else if (uri !== undefined) {
    candidates = [uri];
  }
  return [...new Map(candidates.map((candidate) => [candidate.toString(), candidate])).values()];
}

export function readDrawioOptions(configuration: Configuration): { drawioPath: string } {
  return { drawioPath: readDrawioExecutablePath(configuration) };
}

export function getCommandConfiguration(dependencies?: CommandDependencies): Configuration {
  const getConfiguration = dependencies?.getConfiguration ?? getExtensionConfiguration;
  return getConfiguration();
}

export function assertFileScheme(sourceUri: vscode.Uri): void {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local files are supported: ${sourceUri.toString()}`);
  }
}
