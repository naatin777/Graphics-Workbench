import {
  type CommittedConversionOutput,
  executeRasterConversionBatch,
  type RasterConversionDefinition,
  type RasterJob,
} from './raster_conversion.js';
import { openRasterInput } from './raster_input.js';
import { configs } from '../../generated-extension-meta.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend } from './tools/drawio_tools.js';
import type { GhostscriptBackend } from './tools/ghostscript_tools.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import type { PdftocairoBackend } from './tools/pdftocairo_tools.js';

export type ConvertToAvifJob = RasterJob;

export interface AvifOutputOptions {
  effort: number;
}

export interface ExecuteAvifConversionOptions {
  jobs: ConvertToAvifJob[];
  runtime: ConversionExecutionContext;
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: GhostscriptBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  avif: AvifOutputOptions;
  maxInputPixels?: number;
  runId?: string | undefined;
}

export async function executeAvifConversion(
  options: ExecuteAvifConversionOptions,
): Promise<CommittedConversionOutput[]> {
  const definition: RasterConversionDefinition = {
    operationName: 'convert-to-avif',
    stagingDirectoryName: 'convert-to-avif',
    resultExtension: 'avif',
    encoder: async (sourcePath, outputPath, maxInputPixels, page) => {
      await openRasterInput(sourcePath, maxInputPixels, page).avif({ effort: options.avif.effort }).toFile(outputPath);
    },
    unsupportedInputMessage: (sourcePath) => `Unsupported input for AVIF conversion: ${sourcePath}`,
  };

  return executeRasterConversionBatch({
    ...options,
    maxInputPixels: options.maxInputPixels ?? configs.raster.maxInputPixels(),
    definition,
  });
}
