import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import {
  executeRasterConversion,
  rasterFormatSpecs,
  type RasterConversionTarget,
  type RasterFormatSpec,
  type RasterInput,
} from '@graphics-workbench/core/operations/conversion/raster_conversion.js';
import type { DrawioBackend } from '@graphics-workbench/core/operations/conversion/tools/drawio_tools.js';
import {
  createPdfRenderBackend,
  type PdfRenderBackend,
} from '@graphics-workbench/core/operations/conversion/tools/pdf_render_tools.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createDrawioBackend } from '../../config/rendering/drawio_cli_options.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { planRasterConversionJobs } from './plan_conversion_jobs.js';

export interface ConvertToRasterCommandOptions {
  target: RasterConversionTarget;
  /** アニメーション入力をフレームごとに分割出力する場合は'split'。それ以外は'single'。 */
  cardinality?: 'single' | 'split';
}

interface RasterBackendTools {
  drawioTools: DrawioBackend;
  pdfRenderTools: PdfRenderBackend;
  outputOptions?: { effort: number };
}

function createRasterBackendTools(configuration: Configuration, spec: RasterFormatSpec): RasterBackendTools {
  const tools: RasterBackendTools = {
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
  cardinality?: 'single' | 'split' | undefined;
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
      const prepared = createRasterBackendTools(configuration, spec);
      const maxAnimationPixels = animated ? configuration.raster.maxAnimationPixels() : undefined;
      const plannedInputs: RasterInput[] = [];
      for (const sourceUri of sourceUris) {
        runtime.signal?.throwIfAborted();
        plannedInputs.push(
          ...(await planRasterConversionJobs(sourceUri, spec, {
            configuration,
            maxInputPixels,
            ...(maxAnimationPixels !== undefined ? { maxAnimationPixels } : {}),
            frameMode: options.cardinality === 'split' ? 'all' : 'first',
            runtime,
          })),
        );
      }
      return executeRasterConversion({
        inputs: plannedInputs,
        spec,
        runtime,
        maxInputPixels,
        drawioTools: prepared.drawioTools,
        pdfRenderTools: prepared.pdfRenderTools,
        ...(prepared.outputOptions !== undefined && {
          outputOptions: prepared.outputOptions,
        }),
      });
    },
  });
}

export async function convertToRasterCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  options: ConvertToRasterCommandOptions,
): Promise<void> {
  const { target, cardinality } = options;
  await runRasterCommand({
    sourceUris,
    dependencies,
    spec: rasterFormatSpecs[target],
    cardinality,
  });
}
