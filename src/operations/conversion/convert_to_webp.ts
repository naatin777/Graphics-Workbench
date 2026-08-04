import {
  type CommittedConversionOutput,
  executeRasterConversionBatch,
  type RasterConversionDefinition,
  type RasterJob,
} from './raster_conversion.js';
import { openRasterInput } from './raster_input.js';
import { getDefaultConfiguration } from '../../generated/extension_manifest.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend } from './tools/drawio_tools.js';
import type { GhostscriptBackend } from './tools/ghostscript_tools.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import type { PdftocairoBackend } from './tools/pdftocairo_tools.js';

export type ConvertToWebpJob = RasterJob;

export interface WebpOutputOptions {
  effort: number;
}

export interface ExecuteWebpConversionOptions {
  jobs: ConvertToWebpJob[];
  runtime: ConversionExecutionContext;
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: GhostscriptBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  webp: WebpOutputOptions;
  runId?: string | undefined;
  maxInputPixels?: number;
}

export async function executeWebpConversion(
  options: ExecuteWebpConversionOptions,
): Promise<CommittedConversionOutput[]> {
  const definition: RasterConversionDefinition = {
    operationName: 'convert-to-webp',
    stagingDirectoryName: 'convert-to-webp',
    resultExtension: 'webp',
    encoder: async (sourcePath, outputPath, maxInputPixels, page, animation) => {
      const outputOptions: WebpOutputOptions & { delay?: number[]; loop?: number } = { effort: options.webp.effort };
      if (animation?.delay !== undefined) {
        outputOptions.delay = animation.delay;
      }
      if (animation?.loop !== undefined) {
        outputOptions.loop = animation.loop;
      }
      await openRasterInput(sourcePath, maxInputPixels, page, animation !== undefined)
        .webp(outputOptions)
        .toFile(outputPath);
    },
    unsupportedInputMessage: (sourcePath) => `Unsupported input for WebP conversion: ${sourcePath}`,
  };
  return executeRasterConversionBatch({
    ...options,
    maxInputPixels: options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels(),
    definition,
  });
}
