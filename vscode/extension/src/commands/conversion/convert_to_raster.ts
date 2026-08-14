import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import {
  createPdfRenderBackend,
  executeRasterConversion,
  rasterFormatSpecs,
  type DrawioBackend,
  type PdfRenderBackend,
  type RasterConversionTarget,
  type RasterFormatSpec,
  type RasterInput,
} from '@graphics-workbench/core/conversion';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createDrawioBackend } from '../../config/rendering/drawio_cli_options.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { planRasterConversionItems } from './plan_conversion_items.js';

export interface ConvertToRasterCommandOptions {
  target: RasterConversionTarget;
  /** アニメーション入力を1ファイルに保持するか、フレームごとに分割するか。 */
  animatedInputMode?: 'single' | 'split';
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
  animatedInputMode?: 'single' | 'split' | undefined;
}): Promise<void> {
  const { sourceUris, spec } = options;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(
      userMessage('message.convertToOutput.failed', spec.label, 'No files were selected.'),
    );
    return;
  }

  const { outputChannel } = options.dependencies;
  const animated = spec.animatedInputExtension !== undefined;
  await runConversionLifecycle({
    operationName: spec.operationName,
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages(spec.label, sourceUris.length),
    run: async (runtime) => {
      const configuration = options.dependencies.getConfiguration();
      const maxInputPixels = configuration.raster.maxInputPixels();
      const prepared = createRasterBackendTools(configuration, spec);
      const maxAnimationPixels = animated ? configuration.raster.maxAnimationPixels() : undefined;
      const plannedInputs: RasterInput[] = [];
      for (const sourceUri of sourceUris) {
        runtime.signal?.throwIfAborted();
        plannedInputs.push(
          ...(await planRasterConversionItems(sourceUri, spec, {
            configuration,
            maxInputPixels,
            ...(maxAnimationPixels === undefined ? {} : { maxAnimationPixels }),
            frameMode: options.animatedInputMode === 'split' ? 'all' : 'first',
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
  const { target, animatedInputMode } = options;
  await runRasterCommand({
    sourceUris,
    dependencies,
    spec: rasterFormatSpecs[target],
    animatedInputMode,
  });
}
