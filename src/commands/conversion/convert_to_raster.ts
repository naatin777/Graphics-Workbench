import type * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import {
  executeRasterConversion,
  rasterFormatSpecs,
  type RasterConversionTarget,
  type RasterFormatSpec,
  type RasterJob,
} from '../../operations/conversion/raster_conversion.js';
import type { DrawioBackend } from '../../operations/conversion/tools/drawio_tools.js';
import type { MermaidBackend } from '../../operations/conversion/tools/mermaid_tools.js';
import type { PdfRenderBackend } from '../../operations/conversion/tools/pdf_render_tools.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { buildDrawioCommandOptions } from '../shared/command_runtime.js';

import { planRasterConversionJobs } from './plan_conversion_jobs.js';
import { runRasterConversionCommand, type RasterConversionContext } from './run_raster_conversion_command.js';

export interface ConvertToRasterCommandOptions {
  target: RasterConversionTarget;
  outputMode?: 'auto' | 'preserve' | 'split';
}

interface RasterBackendTools {
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  pdfRenderTools: PdfRenderBackend;
  outputOptions?: { effort: number };
}

type RasterPlanContext = RasterConversionContext<RasterBackendTools>;

function readBackendTools(configuration: Configuration, spec: RasterFormatSpec): RasterBackendTools {
  const tools: RasterBackendTools = {
    mermaidTools: readMermaidCliOptions(configuration),
    drawioTools: buildDrawioCommandOptions(configuration),
    pdfRenderTools: {},
  };
  if (spec.target === 'avif') {
    tools.outputOptions = { effort: configuration.convertToAvif.effort() };
  } else if (spec.target === 'webp') {
    tools.outputOptions = { effort: configuration.convertToWebp.effort() };
  }
  return tools;
}

async function runRasterCommand(options: {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies: CommandDependencies;
  spec: RasterFormatSpec;
  outputMode?: 'auto' | 'preserve' | 'split' | undefined;
}): Promise<void> {
  const { spec } = options;
  const animated = spec.animatedInputExtension !== undefined;
  const plan = async (sourceUri: vscode.Uri, context: RasterPlanContext): Promise<RasterJob[]> =>
    planRasterConversionJobs(sourceUri, spec, {
      configuration: context.configuration,
      maxInputPixels: context.maxInputPixels,
      ...(animated && context.maxAnimationPixels !== undefined
        ? { maxAnimationPixels: context.maxAnimationPixels }
        : {}),
      ...(options.outputMode !== undefined && { outputMode: options.outputMode }),
      runtime: context.runtime,
    });

  return runRasterConversionCommand<RasterJob, RasterBackendTools>({
    uri: options.uri,
    uris: options.uris,
    dependencies: options.dependencies,
    operationName: spec.operationName,
    outputLabel: spec.outputLabel,
    animated,
    prepare: (configuration) => readBackendTools(configuration, spec),
    plan,
    execute: async (jobs, context) =>
      executeRasterConversion({
        jobs,
        spec,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        mermaidTools: context.prepared.mermaidTools,
        drawioTools: context.prepared.drawioTools,
        pdfRenderTools: context.prepared.pdfRenderTools,
        ...(context.prepared.outputOptions !== undefined && {
          outputOptions: context.prepared.outputOptions,
        }),
      }),
  });
}

export async function convertToRasterCommand(
  uri: vscode.Uri | undefined,
  uris: vscode.Uri[] | undefined,
  dependencies: CommandDependencies,
  options?: ConvertToRasterCommandOptions,
): Promise<void> {
  const { target = 'png', outputMode } = options ?? {};
  await runRasterCommand({
    uri,
    uris,
    dependencies,
    spec: rasterFormatSpecs[target],
    outputMode,
  });
}
