import type * as vscode from 'vscode';

import { getDefaultConfiguration, type Configuration } from '../../generated/extension_manifest.js';

import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { executeAvifConversion, type AvifOutputOptions } from '../../operations/conversion/convert_to_avif.js';
import { planAvifConversionJobs } from './plan_avif_conversion_jobs.js';
import { runSimpleRasterConversionCommand } from './run_simple_raster_conversion_command.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readDrawioOptions } from '../shared/command_utils.js';

export async function convertToAvifCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runSimpleRasterConversionCommand({
    uri,
    uris,
    dependencies,
    operationName: 'convert-to-avif',
    outputLabel: 'AVIF',
    prepare: (configuration) => ({
      defaultConfiguration: getDefaultConfiguration(),
      mermaidTools: readMermaidPuppeteerOptions(configuration),
      drawioTools: readDrawioOptions(configuration),
      avif: readAvifOutputOptions(configuration),
      pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
      ghostscriptTools: {
        ghostscriptPath: readGhostscriptExecutablePath(configuration),
        platform: process.platform,
      },
    }),
    plan: async (sourceUri, { configuration, maxInputPixels, prepared, runtime }) =>
      planAvifConversionJobs(sourceUri, configuration, prepared.defaultConfiguration, maxInputPixels, runtime),
    execute: async (jobs, { maxInputPixels, prepared, runtime }) =>
      executeAvifConversion({
        jobs,
        maxInputPixels,
        ...prepared,
        runtime,
      }),
  });
}

function readAvifOutputOptions(configuration: Configuration): AvifOutputOptions {
  const effort = configuration.convertToAvif.effort();

  if (!Number.isInteger(effort) || effort < 0 || effort > 9) {
    throw new Error(`convertToAvif.effort must be an integer between 0 and 9: ${effort}`);
  }

  return { effort };
}
