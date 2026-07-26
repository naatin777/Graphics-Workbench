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

export type ConvertToJpegJob = RasterJob;

export interface ExecuteJpegConversionOptions {
  jobs: ConvertToJpegJob[];
  runtime: ConversionExecutionContext;
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: GhostscriptBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runId?: string | undefined;
  maxInputPixels?: number;
}

const jpegDefinition: RasterConversionDefinition = {
  operationName: 'convert-to-jpeg',
  stagingDirectoryName: 'convert-to-jpeg',
  resultExtension: 'jpeg',
  encoder: async (sourcePath, outputPath, maxInputPixels, page) => {
    await openRasterInput(sourcePath, maxInputPixels, page).jpeg().toFile(outputPath);
  },
  unsupportedInputMessage: (sourcePath) => `Unsupported input for JPEG conversion: ${sourcePath}`,
};

export async function executeJpegConversion(
  options: ExecuteJpegConversionOptions,
): Promise<CommittedConversionOutput[]> {
  return executeRasterConversionBatch({
    ...options,
    maxInputPixels: options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS,
    definition: jpegDefinition,
  });
}
