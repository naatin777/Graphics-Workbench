import * as vscode from 'vscode';

import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { executePngConversion } from '../../operations/conversion/convert_to_png.js';
import { planPngConversionJobs } from './plan_png_conversion_jobs.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError, readDrawioOptions, selectedUris } from '../shared/command_utils.js';

export async function convertToPngCommand(
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
    const mermaidTools = readMermaidPuppeteerOptions(configuration);
    const drawioTools = readDrawioOptions(configuration);
    const pdftocairoTools = { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform };
    const ghostscriptTools = {
      ghostscriptPath: readGhostscriptExecutablePath(configuration),
      platform: process.platform,
    };
    await runConversionLifecycle({
      operationName: 'convert-to-png',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('PNG', sourceUris.length),
      run: async (runtime) => {
        const plannedJobs = await Promise.all(
          sourceUris.map(async (sourceUri) => planPngConversionJobs(sourceUri, configuration, maxInputPixels, runtime)),
        );
        const jobs = plannedJobs.flat();
        return executePngConversion({
          jobs,
          maxInputPixels,
          pdftocairoTools,
          ghostscriptTools,
          mermaidTools,
          drawioTools,
          runtime,
        });
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'PNG'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'PNG', message));
  }
}
