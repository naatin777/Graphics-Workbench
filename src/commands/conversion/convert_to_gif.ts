import type * as vscode from 'vscode';

import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { executeGifConversion } from '../../operations/conversion/convert_to_gif.js';
import { planGifConversionJobs } from './plan_gif_conversion_jobs.js';
import { runAnimatedRasterConversionCommand } from './run_raster_conversion_command.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { buildDrawioCommandOptions } from '../shared/command_runtime.js';

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
      pdfRenderTools: {},
      mermaidTools: readMermaidCliOptions(configuration),
      drawioTools: buildDrawioCommandOptions(configuration),
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
        pdfRenderTools: prepared.pdfRenderTools,
        mermaidTools: prepared.mermaidTools,
        drawioTools: prepared.drawioTools,
        runtime,
      }),
  });
}
