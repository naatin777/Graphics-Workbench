import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import { createMermaidBackend } from '../../config/rendering/mermaid_cli_options.js';
import {
  executeRasterConversion,
  rasterFormatSpecs,
  type RasterConversionTarget,
  type RasterFormatSpec,
  type RasterInput,
} from '../../operations/conversion/raster_conversion.js';
import type { DrawioBackend } from '../../operations/conversion/tools/drawio_tools.js';
import type { MermaidBackend } from '../../operations/conversion/tools/mermaid_tools.js';
import { createPdfRenderBackend, type PdfRenderBackend } from '../../operations/conversion/tools/pdf_render_tools.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createDrawioBackend } from '../../config/rendering/drawio_cli_options.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';

import { planRasterConversionJobs } from './plan_conversion_jobs.js';

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

interface RasterConversionContext {
  configuration: Configuration;
  maxInputPixels: number;
  maxAnimationPixels?: number;
  prepared: RasterBackendTools;
  runtime: ConversionExecutionContext;
}

function createRasterBackendTools(configuration: Configuration, spec: RasterFormatSpec): RasterBackendTools {
  const tools: RasterBackendTools = {
    mermaidTools: createMermaidBackend(configuration),
    drawioTools: createDrawioBackend(configuration),
    pdfRenderTools: createPdfRenderBackend(),
  };
  if (spec.target === 'avif') {
    tools.outputOptions = { effort: configuration.convertToAvif.effort() };
  } else if (spec.target === 'webp') {
    tools.outputOptions = { effort: configuration.convertToWebp.effort() };
  }
  return tools;
}

async function runRasterCommand(options: {
  sourceUris: vscode.Uri[];
  dependencies: CommandDependencies;
  spec: RasterFormatSpec;
  outputMode?: 'auto' | 'preserve' | 'split' | undefined;
}): Promise<void> {
  const { sourceUris, spec } = options;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(
      userMessage('message.convertToOutput.failed', spec.outputLabel, 'No files were selected.'),
    );
    return;
  }

  const outputChannel = options.dependencies.outputChannel;
  const animated = spec.animatedInputExtension !== undefined;
  await runConversionLifecycle({
    operationName: spec.operationName,
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages(spec.outputLabel, sourceUris.length),
    run: async (runtime) => {
      const configuration = options.dependencies.getConfiguration();
      const maxInputPixels = configuration.raster.maxInputPixels();
      const context: RasterConversionContext = {
        configuration,
        maxInputPixels,
        prepared: createRasterBackendTools(configuration, spec),
        runtime,
        ...(animated && { maxAnimationPixels: configuration.raster.maxAnimationPixels() }),
      };
      const plannedInputs: RasterInput[] = [];
      for (const sourceUri of sourceUris) {
        runtime.signal?.throwIfAborted();
        plannedInputs.push(
          ...(await planRasterConversionJobs(sourceUri, spec, {
            configuration: context.configuration,
            maxInputPixels: context.maxInputPixels,
            ...(animated && context.maxAnimationPixels !== undefined
              ? { maxAnimationPixels: context.maxAnimationPixels }
              : {}),
            ...(options.outputMode !== undefined && { outputMode: options.outputMode }),
            runtime: context.runtime,
          })),
        );
      }
      return executeRasterConversion({
        inputs: plannedInputs,
        spec,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        mermaidTools: context.prepared.mermaidTools,
        drawioTools: context.prepared.drawioTools,
        pdfRenderTools: context.prepared.pdfRenderTools,
        ...(context.prepared.outputOptions !== undefined && {
          outputOptions: context.prepared.outputOptions,
        }),
      });
    },
  });
}

export async function convertToRasterCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  options?: ConvertToRasterCommandOptions,
): Promise<void> {
  const { target = 'png', outputMode } = options ?? {};
  await runRasterCommand({
    sourceUris,
    dependencies,
    spec: rasterFormatSpecs[target],
    outputMode,
  });
}
