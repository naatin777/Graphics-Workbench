import * as path from 'node:path';
import * as vscode from 'vscode';

import { readConvertToRawOutputPath } from '../../config/output/output_path_settings.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import { isRasterImagePath } from '../../application/policy/source_format.js';
import { convertToRawFiles, type ConvertToRawJob } from '../../operations/conversion/convert_to_raw.js';
import { createRasterFrameJobs } from './create_raster_frame_jobs.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { assertFileScheme, getCommandConfiguration, isAbortError, selectedUris } from '../shared/command_utils.js';
import { userMessage } from '../shared/user_messages.js';

export const CONVERT_TO_RAW_COMMAND = 'graphics-workbench.convertToRaw';

const defaultOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.raw';

export async function convertToRawCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = selectedUris(uri, uris);
    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }

    const configuration = getCommandConfiguration(dependencies);
    const sourceExt = path.extname(sourceUris[0]?.fsPath ?? '');
    const outputTemplate = readConvertToRawOutputPath(configuration, sourceExt, defaultOutputPath);
    const maxInputPixels = getMaxInputPixels(configuration);
    const plannedJobs = await Promise.all(
      sourceUris.map(async (sourceUri) => planRawConversionJobs(sourceUri, outputTemplate, maxInputPixels)),
    );
    const jobs = plannedJobs.flat();
    await runConversionLifecycle({
      operationName: 'convert-to-raw',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('RAW', sourceUris.length),
      run: async (runtime) => convertToRawFiles({ jobs, maxInputPixels, runtime }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'RAW'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'RAW', message));
  }
}

async function planRawConversionJobs(
  sourceUri: vscode.Uri,
  outputTemplate: string,
  maxInputPixels: number,
): Promise<ConvertToRawJob[]> {
  assertFileScheme(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  if (!isRasterImagePath(sourcePath)) {
    throw new Error(`Unsupported input for RAW conversion: ${sourcePath}`);
  }

  return createRasterFrameJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.raw'],
    maxInputPixels,
    createJob: (job) => job,
  });
}
