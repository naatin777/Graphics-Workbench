import type * as vscode from 'vscode';

import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { executePngConversion } from '../../operations/conversion/convert_to_png.js';
import { planPngConversionJobs } from './plan_png_conversion_jobs.js';
import { runSimpleRasterConversionCommand } from './run_raster_conversion_command.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { readDrawioOptions } from '../shared/command_utils.js';

export async function convertToPngCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runSimpleRasterConversionCommand({
    uri,
    uris,
    dependencies,
    operationName: 'convert-to-png',
    outputLabel: 'PNG',
    prepare: (configuration) => ({
      mermaidTools: readMermaidCliOptions(configuration),
      drawioTools: readDrawioOptions(configuration),
      pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
      ghostscriptTools: {
        ghostscriptPath: readGhostscriptExecutablePath(configuration),
        platform: process.platform,
      },
    }),
    plan: async (sourceUri, { configuration, maxInputPixels, runtime }) =>
      planPngConversionJobs(sourceUri, configuration, maxInputPixels, runtime),
    execute: async (jobs, { maxInputPixels, prepared, runtime }) =>
      executePngConversion({
        jobs,
        maxInputPixels,
        ...prepared,
        runtime,
      }),
  });
}
