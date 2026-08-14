import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { isDrawioImagePath, isNativeDrawioPath } from '../../shared/source_format.js';
import { assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';

import {
  convertToPdfFiles,
  executeChrome,
  executeRsvgConvert,
  validateSvgToPdfOptions,
  type ConvertToPdfFilesOptions,
  type PdfInput,
} from './convert_to_pdf.js';
import { convertDrawioToSinglePdf, type DrawioPdfInput } from './convert_drawio_to_pdf.js';
import { convertToSvgFiles, type SvgInput } from './convert_to_svg.js';
import {
  executeRasterConversion,
  rasterFormatSpecs,
  type ExecuteRasterConversionOptions,
  type RasterInput,
} from './raster_conversion.js';
import { executeDrawio, type DrawioBackend } from './tools/drawio_tools.js';
import { createPdfRenderBackend } from './tools/pdf_render_tools.js';
import type { SvgToPdfBackend } from './tools/svg_to_pdf_tools.js';
import { convertToDrawioFiles, type DrawioComposeInput } from './convert_to_drawio.js';
import { renderPdfPageToSvg } from '../pdf/mupdf.js';
import { planRasterConversionInputs } from './plan_conversion_inputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import {
  toConversionResult,
  type ConversionConfiguration,
  type ConversionResult,
  type ConversionSource,
} from './convert_errors.js';

function buildDrawioBackend(configuration: ConversionConfiguration): DrawioBackend {
  return { drawioPath: configuration.drawioPath, runDrawio: executeDrawio };
}

function buildSvgToPdfBackend(configuration: ConversionConfiguration): SvgToPdfBackend {
  return {
    engine: configuration.svgToPdf.engine,
    rsvgConvertPath: configuration.svgToPdf.rsvgConvertPath,
    chromePath: configuration.svgToPdf.chromePath,
    runRsvgConvert: executeRsvgConvert,
    runChrome: executeChrome,
  };
}

function resolveSingleOutput(
  source: ConversionSource,
  outputTemplate: string,
  allowedExtensions: readonly string[],
): string {
  return resolveOutputPath(
    outputTemplate,
    {
      sourcePath: source.sourcePath,
      workspacePath: source.workspacePath,
      workspaceName: source.workspaceName,
    },
    { allowedExtensions },
  );
}

/** Converts each source (image, SVG, PDF, Draw.io) to a single PDF. */
export async function convertSinglePdf(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const drawioInputs: DrawioPdfInput[] = [];
    const pdfInputs: PdfInput[] = [];
    for (const source of sources) {
      if (isNativeDrawioPath(source.sourcePath)) {
        drawioInputs.push({
          sourcePath: source.sourcePath,
          outputTemplate,
          workspacePath: source.workspacePath,
          workspaceName: source.workspaceName,
        });
      } else {
        pdfInputs.push({
          sourcePath: source.sourcePath,
          workspacePath: source.workspacePath,
          outputPath: resolveSingleOutput(source, outputTemplate, ['.pdf']),
        });
      }
    }
    if (drawioInputs.length > 0 && configuration.drawioPath.trim() === '') {
      throw new Error('Draw.io executable is not configured. Set graphics-workbench.execPath.drawio.');
    }
    const drawioOutputs =
      drawioInputs.length > 0
        ? await convertDrawioToSinglePdf({
            inputs: drawioInputs,
            drawioPath: configuration.drawioPath,
            runDrawio: executeDrawio,
            runtime,
          })
        : [];
    const pdfOutputs =
      pdfInputs.length > 0
        ? await (async () => {
            const svgToPdfTools = buildSvgToPdfBackend(configuration);
            validateSvgToPdfOptions(svgToPdfTools);
            const options: ConvertToPdfFilesOptions = {
              inputs: pdfInputs,
              maxInputPixels: configuration.maxInputPixels,
              tools: {
                svgToPdfTools,
                drawioTools: buildDrawioBackend(configuration),
              },
              platform: configuration.platform,
              ...(configuration.scratchBaseCandidates !== undefined && {
                scratchBaseCandidates: configuration.scratchBaseCandidates,
              }),
              runtime,
            };
            return convertToPdfFiles(options);
          })()
        : [];
    return [...drawioOutputs, ...pdfOutputs];
  }, runtime.signal);
}

/** Converts each source (Draw.io, PDF page, raster image) to a single SVG. */
export async function convertSingleSvg(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: SvgInput[] = sources.map((source) => {
      const page = isDrawioImagePath(source.sourcePath) ? 1 : undefined;
      return {
        sourcePath: source.sourcePath,
        workspacePath: source.workspacePath,
        outputPath: resolveOutputPath(
          outputTemplate,
          {
            sourcePath: source.sourcePath,
            workspacePath: source.workspacePath,
            workspaceName: source.workspaceName,
            ...(page !== undefined && { page: String(page) }),
          },
          { allowedExtensions: ['.svg'] },
        ),
        ...(page !== undefined && { page }),
      };
    });
    return convertToSvgFiles({
      inputs,
      maxInputPixels: configuration.maxInputPixels,
      drawioTools: buildDrawioBackend(configuration),
      runtime,
    });
  }, runtime.signal);
}

/** Converts each source to a single PNG. */
export async function convertSinglePng(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.png,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'first',
        maxInputPixels: configuration.maxInputPixels,
        maxAnimationPixels: configuration.maxAnimationPixels,
        isDrawioImagePath,
        ...(runtime.signal !== undefined && { signal: runtime.signal }),
        ...(runtime.reportMessage !== undefined && { report: runtime.reportMessage }),
      });
      inputs.push(...planned);
    }
    const rasterOptions: ExecuteRasterConversionOptions = {
      inputs,
      spec: rasterFormatSpecs.png,
      runtime,
      maxInputPixels: configuration.maxInputPixels,
      pdfRenderTools: createPdfRenderBackend(),
      drawioTools: buildDrawioBackend(configuration),
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Converts each source to a single JPEG. */
export async function convertSingleJpeg(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.jpeg,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'first',
        maxInputPixels: configuration.maxInputPixels,
        maxAnimationPixels: configuration.maxAnimationPixels,
        isDrawioImagePath,
        ...(runtime.signal !== undefined && { signal: runtime.signal }),
        ...(runtime.reportMessage !== undefined && { report: runtime.reportMessage }),
      });
      inputs.push(...planned);
    }
    const rasterOptions: ExecuteRasterConversionOptions = {
      inputs,
      spec: rasterFormatSpecs.jpeg,
      runtime,
      maxInputPixels: configuration.maxInputPixels,
      pdfRenderTools: createPdfRenderBackend(),
      drawioTools: buildDrawioBackend(configuration),
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Converts each source to a single WebP. */
export async function convertSingleWebp(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.webp,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'first',
        maxInputPixels: configuration.maxInputPixels,
        maxAnimationPixels: configuration.maxAnimationPixels,
        isDrawioImagePath,
        ...(runtime.signal !== undefined && { signal: runtime.signal }),
        ...(runtime.reportMessage !== undefined && { report: runtime.reportMessage }),
      });
      inputs.push(...planned);
    }
    const rasterOptions: ExecuteRasterConversionOptions = {
      inputs,
      spec: rasterFormatSpecs.webp,
      runtime,
      maxInputPixels: configuration.maxInputPixels,
      pdfRenderTools: createPdfRenderBackend(),
      drawioTools: buildDrawioBackend(configuration),
      outputOptions: { effort: configuration.webpEffort },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Converts each source to a single AVIF. */
export async function convertSingleAvif(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.avif,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'first',
        maxInputPixels: configuration.maxInputPixels,
        maxAnimationPixels: configuration.maxAnimationPixels,
        isDrawioImagePath,
        ...(runtime.signal !== undefined && { signal: runtime.signal }),
        ...(runtime.reportMessage !== undefined && { report: runtime.reportMessage }),
      });
      inputs.push(...planned);
    }
    const rasterOptions: ExecuteRasterConversionOptions = {
      inputs,
      spec: rasterFormatSpecs.avif,
      runtime,
      maxInputPixels: configuration.maxInputPixels,
      pdfRenderTools: createPdfRenderBackend(),
      drawioTools: buildDrawioBackend(configuration),
      outputOptions: { effort: configuration.avifEffort },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Converts each source to a single GIF. */
export async function convertSingleGif(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.gif,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'first',
        maxInputPixels: configuration.maxInputPixels,
        maxAnimationPixels: configuration.maxAnimationPixels,
        isDrawioImagePath,
        ...(runtime.signal !== undefined && { signal: runtime.signal }),
        ...(runtime.reportMessage !== undefined && { report: runtime.reportMessage }),
      });
      inputs.push(...planned);
    }
    const rasterOptions: ExecuteRasterConversionOptions = {
      inputs,
      spec: rasterFormatSpecs.gif,
      runtime,
      maxInputPixels: configuration.maxInputPixels,
      pdfRenderTools: createPdfRenderBackend(),
      drawioTools: buildDrawioBackend(configuration),
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Converts each source to a single TIFF. */
export async function convertSingleTiff(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.tiff,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'first',
        maxInputPixels: configuration.maxInputPixels,
        maxAnimationPixels: configuration.maxAnimationPixels,
        isDrawioImagePath,
        ...(runtime.signal !== undefined && { signal: runtime.signal }),
        ...(runtime.reportMessage !== undefined && { report: runtime.reportMessage }),
      });
      inputs.push(...planned);
    }
    const rasterOptions: ExecuteRasterConversionOptions = {
      inputs,
      spec: rasterFormatSpecs.tiff,
      runtime,
      maxInputPixels: configuration.maxInputPixels,
      pdfRenderTools: createPdfRenderBackend(),
      drawioTools: buildDrawioBackend(configuration),
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Converts sources (images/PDFs) into a single Draw.io file. */
export async function convertSingleDrawio(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const firstSource = sources[0];
    if (firstSource === undefined) {
      throw new Error('No files were selected.');
    }
    const workspacePath = firstSource.workspacePath;
    const outputPath = resolveSingleOutput(firstSource, outputTemplate, ['.drawio', '.drawio.png', '.drawio.svg']);
    const composeInput: DrawioComposeInput = {
      inputs: sources.map((source) => ({ sourcePath: source.sourcePath })),
      outputPath,
      workspacePath,
    };
    await assertWritablePathInWorkspace(outputPath, workspacePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    return convertToDrawioFiles({
      inputs: [composeInput],
      maxInputPixels: configuration.maxInputPixels,
      tools: {
        drawioPath: configuration.drawioPath,
        runPdfToSvg: renderPdfPageToSvgFile,
        runDrawio: executeDrawio,
      },
      runtime,
    });
  }, runtime.signal);
}

async function renderPdfPageToSvgFile(
  sourcePath: string,
  outputPath: string,
  page: number,
  signal: AbortSignal,
): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises');
  signal.throwIfAborted();
  const svg = await renderPdfPageToSvg(await readFile(sourcePath), page);
  signal.throwIfAborted();
  await writeFile(outputPath, svg, 'utf8');
}
