import {
  type CommittedConversionOutput,
  executeRasterConversionBatch,
  type RasterConversionDefinition,
  type RasterJob,
} from './raster_conversion.js';
import { openRasterInput } from './raster_input.js';
import { getDefaultConfiguration } from '../../generated-extension-meta.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend } from './tools/drawio_tools.js';
import type { GhostscriptBackend } from './tools/ghostscript_tools.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import type { PdftocairoBackend } from './tools/pdftocairo_tools.js';

export type ConvertToGifJob = RasterJob;

export interface ExecuteGifConversionOptions {
  jobs: ConvertToGifJob[];
  runtime: ConversionExecutionContext;
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: GhostscriptBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runId?: string | undefined;
  maxInputPixels?: number;
}

const gifDefinition: RasterConversionDefinition = {
  operationName: 'convert-to-gif',
  stagingDirectoryName: 'convert-to-gif',
  resultExtension: 'gif',
  encoder: async (sourcePath, outputPath, maxInputPixels, page, animation) => {
    const outputOptions: { delay?: number[]; loop?: number } = {};
    if (animation?.delay !== undefined) {
      outputOptions.delay = animation.delay;
    }
    if (animation?.loop !== undefined) {
      outputOptions.loop = animation.loop;
    }
    await openRasterInput(sourcePath, maxInputPixels, page, animation !== undefined)
      .gif(outputOptions)
      .toFile(outputPath);
  },
  unsupportedInputMessage: (sourcePath) => `Unsupported input for GIF conversion: ${sourcePath}`,
};

export async function executeGifConversion(options: ExecuteGifConversionOptions): Promise<CommittedConversionOutput[]> {
  return executeRasterConversionBatch({
    ...options,
    maxInputPixels: options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels(),
    definition: gifDefinition,
  });
}
