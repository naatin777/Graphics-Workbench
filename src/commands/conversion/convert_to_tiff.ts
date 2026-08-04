import * as vscode from 'vscode';

import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { executeTiffConversion } from '../../operations/conversion/convert_to_tiff.js';
import { planTiffConversionJobs } from './plan_tiff_conversion_jobs.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError, readDrawioOptions, selectedUris } from '../shared/command_utils.js';

export async function convertToTiffCommand(
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
    const maxInputPixels = getMaxInputPixels(configuration);
    await runConversionLifecycle({
      operationName: 'convert-to-tiff',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('TIFF', sourceUris.length),
      run: async (runtime) => {
        const plannedJobs = await Promise.all(
          sourceUris.map(async (sourceUri) =>
            planTiffConversionJobs(sourceUri, configuration, maxInputPixels, runtime),
          ),
        );
        const jobs = plannedJobs.flat();
        return executeTiffConversion({
          jobs,
          maxInputPixels,
          pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
          ghostscriptTools: {
            ghostscriptPath: readGhostscriptExecutablePath(configuration),
            platform: process.platform,
          },
          mermaidTools: readMermaidPuppeteerOptions(configuration),
          drawioTools: readDrawioOptions(configuration),
          runtime,
        });
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'TIFF'));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'TIFF', message));
  }
}
