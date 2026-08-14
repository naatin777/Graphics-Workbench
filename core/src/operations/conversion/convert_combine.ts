import { combineImagesToPdf, type CombineImagesToPdfOptions } from './combine_images_to_pdf.js';
import { executeChrome, executeRsvgConvert, validateSvgToPdfOptions } from './convert_to_pdf.js';
import type { SvgToPdfBackend } from './tools/svg_to_pdf_tools.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import {
  toConversionResult,
  type ConversionConfiguration,
  type ConversionResult,
  type ConversionSource,
} from './convert_errors.js';

function buildSvgToPdfBackend(configuration: ConversionConfiguration): SvgToPdfBackend {
  return {
    engine: configuration.svgToPdf.engine,
    rsvgConvertPath: configuration.svgToPdf.rsvgConvertPath,
    chromePath: configuration.svgToPdf.chromePath,
    runRsvgConvert: executeRsvgConvert,
    runChrome: executeChrome,
  };
}

/** Combines multiple image sources into a single PDF. */
export async function convertCombinePdf(
  sources: ConversionSource[],
  outputPath: string,
  workspacePath: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const svgToPdfTools = buildSvgToPdfBackend(configuration);
    validateSvgToPdfOptions(svgToPdfTools);
    const options: CombineImagesToPdfOptions = {
      inputs: sources.map((source) => ({ sourcePath: source.sourcePath })),
      outputPath,
      workspacePath,
      runtime,
      maxInputPixels: configuration.maxInputPixels,
      platform: configuration.platform,
      tools: { svgToPdfTools },
      ...(configuration.scratchBaseCandidates !== undefined && {
        scratchBaseCandidates: configuration.scratchBaseCandidates,
      }),
    };
    return combineImagesToPdf(options);
  }, runtime.signal);
}
