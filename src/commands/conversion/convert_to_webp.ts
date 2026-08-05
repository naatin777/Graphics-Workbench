import type * as vscode from 'vscode';

import { getDefaultConfiguration, type Configuration } from '../../generated/extension_manifest.js';

import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { executeWebpConversion, type WebpOutputOptions } from '../../operations/conversion/convert_to_webp.js';
import { planWebpConversionJobs } from './plan_webp_conversion_jobs.js';
import { runAnimatedRasterConversionCommand } from './run_animated_raster_conversion_command.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readDrawioOptions } from '../shared/command_utils.js';

export interface ConvertToWebpCommandOptions {
  outputMode?: 'auto' | 'preserve' | 'split';
}

export async function convertToWebpCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
  options?: ConvertToWebpCommandOptions,
): Promise<void> {
  await runAnimatedRasterConversionCommand({
    uri,
    uris,
    dependencies,
    operationName: 'convert-to-webp',
    outputLabel: 'WebP',
    ...(options?.outputMode !== undefined && { outputMode: options.outputMode }),
    prepare: (configuration) => ({
      defaultConfiguration: getDefaultConfiguration(),
      mermaidTools: readMermaidPuppeteerOptions(configuration),
      drawioTools: readDrawioOptions(configuration),
      webp: readWebpOutputOptions(configuration),
      pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
      ghostscriptTools: {
        ghostscriptPath: readGhostscriptExecutablePath(configuration),
        platform: process.platform,
      },
    }),
    plan: async (sourceUri, { configuration, maxInputPixels, maxAnimationPixels, prepared, runtime }) =>
      planWebpConversionJobs(sourceUri, {
        configuration,
        defaultConfiguration: prepared.defaultConfiguration,
        maxInputPixels,
        maxAnimationPixels,
        ...(options?.outputMode !== undefined && { outputMode: options.outputMode }),
        runtime,
      }),
    execute: async (jobs, { maxInputPixels, prepared, runtime }) =>
      executeWebpConversion({
        jobs,
        maxInputPixels,
        mermaidTools: prepared.mermaidTools,
        drawioTools: prepared.drawioTools,
        webp: prepared.webp,
        pdftocairoTools: prepared.pdftocairoTools,
        ghostscriptTools: prepared.ghostscriptTools,
        runtime,
      }),
  });
}

function readWebpOutputOptions(configuration: Configuration): WebpOutputOptions {
  const effort = configuration.convertToWebp.effort();

  if (!Number.isInteger(effort) || effort < 0 || effort > 6) {
    throw new Error(`convertToWebp.effort must be an integer between 0 and 6: ${effort}`);
  }

  return { effort };
}
