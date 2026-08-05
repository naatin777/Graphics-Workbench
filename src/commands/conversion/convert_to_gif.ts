import type * as vscode from 'vscode';

import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { executeGifConversion } from '../../operations/conversion/convert_to_gif.js';
import { planGifConversionJobs } from './plan_gif_conversion_jobs.js';
import { runAnimatedRasterConversionCommand } from './run_raster_conversion_command.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readDrawioOptions } from '../shared/command_utils.js';

export interface ConvertToGifCommandOptions {
  outputMode?: 'auto' | 'preserve' | 'split';
}

export async function convertToGifCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
  options?: ConvertToGifCommandOptions,
): Promise<void> {
  await runAnimatedRasterConversionCommand({
    uri,
    uris,
    dependencies,
    operationName: 'convert-to-gif',
    outputLabel: 'GIF',
    prepare: (configuration) => ({
      pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
      ghostscriptTools: {
        ghostscriptPath: readGhostscriptExecutablePath(configuration),
        platform: process.platform,
      },
      mermaidTools: readMermaidPuppeteerOptions(configuration),
      drawioTools: readDrawioOptions(configuration),
    }),
    plan: async (sourceUri, { configuration, maxInputPixels, maxAnimationPixels, runtime }) =>
      planGifConversionJobs(sourceUri, {
        configuration,
        maxInputPixels,
        maxAnimationPixels,
        ...(options?.outputMode !== undefined && { outputMode: options.outputMode }),
        runtime,
      }),
    execute: async (jobs, { maxInputPixels, prepared, runtime }) =>
      executeGifConversion({
        jobs,
        maxInputPixels,
        pdftocairoTools: prepared.pdftocairoTools,
        ghostscriptTools: prepared.ghostscriptTools,
        mermaidTools: prepared.mermaidTools,
        drawioTools: prepared.drawioTools,
        runtime,
      }),
  });
}
