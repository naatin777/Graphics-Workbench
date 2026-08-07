import type * as vscode from 'vscode';

import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { executeTiffConversion } from '../../operations/conversion/convert_to_tiff.js';
import { planTiffConversionJobs } from './plan_tiff_conversion_jobs.js';
import { runSimpleRasterConversionCommand } from './run_raster_conversion_command.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { buildDrawioCommandOptions } from '../shared/command_runtime.js';

export async function convertToTiffCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runSimpleRasterConversionCommand({
    uri,
    uris,
    dependencies,
    operationName: 'convert-to-tiff',
    outputLabel: 'TIFF',
    prepare: (configuration) => ({
      mermaidTools: readMermaidCliOptions(configuration),
      drawioTools: buildDrawioCommandOptions(configuration),
      pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
      ghostscriptTools: {
        ghostscriptPath: readGhostscriptExecutablePath(configuration),
        platform: process.platform,
      },
    }),
    plan: async (sourceUri, { configuration, maxInputPixels, runtime }) =>
      planTiffConversionJobs(sourceUri, configuration, maxInputPixels, runtime),
    execute: async (jobs, { maxInputPixels, prepared, runtime }) =>
      executeTiffConversion({
        jobs,
        maxInputPixels,
        ...prepared,
        runtime,
      }),
  });
}
