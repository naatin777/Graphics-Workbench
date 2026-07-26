import {
  type CommittedConversionOutput,
  executeRasterConversionBatch,
  type RasterConversionDefinition,
  type RasterJob,
} from './raster_conversion.js';
import { openRasterInput } from './raster_input.js';
import { DEFAULT_MAX_INPUT_PIXELS } from '../../config/raster_input.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend } from './tools/drawio_tools.js';
import type { GhostscriptBackend } from './tools/ghostscript_tools.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import type { PdftocairoBackend } from './tools/pdftocairo_tools.js';

export type ConvertToTiffJob = RasterJob;

export interface ExecuteTiffConversionOptions {
  jobs: ConvertToTiffJob[];
  runtime: ConversionExecutionContext;
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: GhostscriptBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runId?: string | undefined;
  maxInputPixels?: number;
}

const tiffDefinition: RasterConversionDefinition = {
  operationName: 'convert-to-tiff',
  stagingDirectoryName: 'convert-to-tiff',
  resultExtension: 'tiff',
  encoder: async (sourcePath, outputPath, maxInputPixels, page) => {
    await openRasterInput(sourcePath, maxInputPixels, page).tiff().toFile(outputPath);
  },
  unsupportedInputMessage: (sourcePath) => `Unsupported input for TIFF conversion: ${sourcePath}`,
};

export async function executeTiffConversion(
  options: ExecuteTiffConversionOptions,
): Promise<CommittedConversionOutput[]> {
  return executeRasterConversionBatch({
    ...options,
    maxInputPixels: options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS,
    definition: tiffDefinition,
  });
}
