import type * as vscode from 'vscode';

import { readDrawioExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { configureExternalToolTimeouts } from '../../config/external_tools/external_tool_settings.js';
import { getMaxConcurrentHeavyProcesses } from '../../config/performance.js';
import { getExtensionConfiguration } from '../../config/extension_configuration.js';
import type { Configuration } from '../../generated/extension_manifest.js';
import {
  sharedConversionJobLimiter,
  sharedHeavyProcessLimiter,
} from '../../operations/external_tools/heavy_process_limiter.js';

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
  const configuration = getConfiguration();
  configureExternalToolTimeouts(configuration);
  const concurrency = getMaxConcurrentHeavyProcesses(configuration);
  sharedHeavyProcessLimiter.setConcurrency(concurrency);
  sharedConversionJobLimiter.setConcurrency(concurrency);
  return configuration;
}

export function assertFileScheme(sourceUri: vscode.Uri): void {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local files are supported: ${sourceUri.toString()}`);
  }
}
