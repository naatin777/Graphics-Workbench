import type * as vscode from 'vscode';

import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { executePngConversion } from '../../operations/conversion/convert_to_png.js';
import { planPngConversionJobs } from './plan_png_conversion_jobs.js';
import { runSimpleRasterConversionCommand } from './run_raster_conversion_command.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { buildDrawioCommandOptions } from '../shared/command_runtime.js';

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
      drawioTools: buildDrawioCommandOptions(configuration),
      pdftocairoTools: {},
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
