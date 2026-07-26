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

export type ConvertToPngJob = RasterJob;

export interface ExecutePngConversionOptions {
  jobs: ConvertToPngJob[];
  runtime: ConversionExecutionContext;
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: GhostscriptBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runId?: string | undefined;
  maxInputPixels?: number;
}

const pngDefinition: RasterConversionDefinition = {
  operationName: 'convert-to-png',
  stagingDirectoryName: 'convert-to-png',
  resultExtension: 'png',
  encoder: async (sourcePath, outputPath, maxInputPixels, page) => {
    await openRasterInput(sourcePath, maxInputPixels, page).png().toFile(outputPath);
  },
  unsupportedInputMessage: (sourcePath) => `Unsupported input for PNG conversion: ${sourcePath}`,
};

export async function executePngConversion(options: ExecutePngConversionOptions): Promise<CommittedConversionOutput[]> {
  return executeRasterConversionBatch({
    ...options,
    maxInputPixels: options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS,
    definition: pngDefinition,
  });
}
