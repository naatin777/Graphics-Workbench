import type * as vscode from 'vscode';

import { getDefaultConfiguration } from '../../generated/extension_manifest.js';
import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { executeJpegConversion } from '../../operations/conversion/convert_to_jpeg.js';
import { planJpegConversionJobs } from './plan_jpeg_conversion_jobs.js';
import { runSimpleRasterConversionCommand } from './run_raster_conversion_command.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readDrawioOptions } from '../shared/command_utils.js';

export async function convertToJpegCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runSimpleRasterConversionCommand({
    uri,
    uris,
    dependencies,
    operationName: 'convert-to-jpeg',
    outputLabel: 'JPEG',
    prepare: (configuration) => ({
      defaultConfiguration: getDefaultConfiguration(),
      mermaidTools: readMermaidPuppeteerOptions(configuration),
      drawioTools: readDrawioOptions(configuration),
      pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
      ghostscriptTools: {
        ghostscriptPath: readGhostscriptExecutablePath(configuration),
        platform: process.platform,
      },
    }),
    plan: async (sourceUri, { configuration, maxInputPixels, prepared, runtime }) =>
      planJpegConversionJobs(sourceUri, configuration, prepared.defaultConfiguration, maxInputPixels, runtime),
    execute: async (jobs, { maxInputPixels, prepared, runtime }) =>
      executeJpegConversion({
        jobs,
        maxInputPixels,
        ...prepared,
        runtime,
      }),
  });
}
