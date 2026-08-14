import { isDrawioImagePath, logicalSourcePathForOutputTemplate } from '../../shared/source_format.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { formatOutputPage } from '../../config/output/page_template.js';

import { convertDrawioToPagePdfs, type DrawioPdfInput } from './convert_drawio_to_pdf.js';
import { convertToSvgFiles, type SvgInput } from './convert_to_svg.js';
import {
  executeRasterConversion,
  rasterFormatSpecs,
  type ExecuteRasterConversionOptions,
  type RasterInput,
} from './raster_conversion.js';
import { executeDrawio } from './tools/drawio_tools.js';
import { createPdfRenderBackend } from './tools/pdf_render_tools.js';
import { planRasterConversionInputs, planPdfPageConversionInputs } from './plan_conversion_inputs.js';
import { countPdfPages } from '../pdf/mupdf.js';
import { readFile } from 'node:fs/promises';
import { splitPdfAllPages, type SplitPdfInput } from '../pdf/split_pdf.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import {
  toConversionResult,
  type ConversionConfiguration,
  type ConversionResult,
  type ConversionSource,
} from './convert_errors.js';

/** Splits each Draw.io/PDF source into one PDF per page. */
export async function convertSplitPdf(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const drawioInputs: DrawioPdfInput[] = [];
    const pdfInputs: SplitPdfInput[] = [];
    for (const source of sources) {
      if (isDrawioImagePath(source.sourcePath) || source.sourcePath.toLowerCase().endsWith('.drawio')) {
        drawioInputs.push({
          sourcePath: source.sourcePath,
          outputTemplate,
          workspacePath: source.workspacePath,
          workspaceName: source.workspaceName,
        });
      } else {
        const pageCount = await countPdfPages(await readFile(source.sourcePath));
        const { workspacePath, workspaceName } = source;
        pdfInputs.push({
          sourcePath: source.sourcePath,
          workspacePath: source.workspacePath,
          outputPathForPage: (page) =>
            resolveOutputPath(
              outputTemplate,
              {
                sourcePath: logicalSourcePathForOutputTemplate(source.sourcePath),
                workspacePath,
                workspaceName,
                page: formatOutputPage(page, pageCount),
              },
              { allowedExtensions: ['.pdf'] },
            ),
        });
      }
    }
    const drawioOutputs =
      drawioInputs.length > 0
        ? await convertDrawioToPagePdfs({
            inputs: drawioInputs,
            drawioPath: configuration.drawioPath,
            runDrawio: executeDrawio,
            runtime,
          })
        : [];
    const pdfOutputs =
      pdfInputs.length > 0
        ? await splitPdfAllPages({
            inputs: pdfInputs,
            runtime,
          })
        : [];
    return [...drawioOutputs, ...pdfOutputs];
  }, runtime.signal);
}

/** Splits each source into per-page PNG frames. */
export async function convertSplitPng(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      if (source.sourcePath.toLowerCase().endsWith('.pdf')) {
        const planned = await planPdfPageRasterInputs(source, rasterFormatSpecs.png.extensions, outputTemplate);
        inputs.push(...planned);
        continue;
      }
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.png,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'all',
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
      drawioTools: { drawioPath: configuration.drawioPath, runDrawio: executeDrawio },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Splits each source into per-page JPEG frames. */
export async function convertSplitJpeg(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      if (source.sourcePath.toLowerCase().endsWith('.pdf')) {
        const planned = await planPdfPageRasterInputs(source, rasterFormatSpecs.jpeg.extensions, outputTemplate);
        inputs.push(...planned);
        continue;
      }
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.jpeg,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'all',
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
      drawioTools: { drawioPath: configuration.drawioPath, runDrawio: executeDrawio },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Splits each source into per-page WebP frames. */
export async function convertSplitWebp(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      if (source.sourcePath.toLowerCase().endsWith('.pdf')) {
        const planned = await planPdfPageRasterInputs(source, rasterFormatSpecs.webp.extensions, outputTemplate);
        inputs.push(...planned);
        continue;
      }
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.webp,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'all',
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
      drawioTools: { drawioPath: configuration.drawioPath, runDrawio: executeDrawio },
      outputOptions: { effort: configuration.webpEffort },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Splits each source into per-page AVIF frames. */
export async function convertSplitAvif(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      if (source.sourcePath.toLowerCase().endsWith('.pdf')) {
        const planned = await planPdfPageRasterInputs(source, rasterFormatSpecs.avif.extensions, outputTemplate);
        inputs.push(...planned);
        continue;
      }
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.avif,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'all',
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
      drawioTools: { drawioPath: configuration.drawioPath, runDrawio: executeDrawio },
      outputOptions: { effort: configuration.avifEffort },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Splits each source into per-page GIF frames. */
export async function convertSplitGif(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      if (source.sourcePath.toLowerCase().endsWith('.pdf')) {
        const planned = await planPdfPageRasterInputs(source, rasterFormatSpecs.gif.extensions, outputTemplate);
        inputs.push(...planned);
        continue;
      }
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.gif,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'all',
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
      drawioTools: { drawioPath: configuration.drawioPath, runDrawio: executeDrawio },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Splits each source into per-page TIFF frames. */
export async function convertSplitTiff(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: RasterInput[] = [];
    for (const source of sources) {
      if (source.sourcePath.toLowerCase().endsWith('.pdf')) {
        const planned = await planPdfPageRasterInputs(source, rasterFormatSpecs.tiff.extensions, outputTemplate);
        inputs.push(...planned);
        continue;
      }
      const planned = await planRasterConversionInputs({
        source: { ...source },
        spec: rasterFormatSpecs.tiff,
        outputTemplate,
        splitOutputTemplate: outputTemplate,
        frameMode: 'all',
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
      drawioTools: { drawioPath: configuration.drawioPath, runDrawio: executeDrawio },
    };
    return executeRasterConversion(rasterOptions);
  }, runtime.signal);
}

/** Splits each PDF into per-page SVGs. */
export async function convertSplitSvg(
  sources: ConversionSource[],
  outputTemplate: string,
  configuration: ConversionConfiguration,
  runtime: ConversionExecutionContext,
): Promise<ConversionResult> {
  return toConversionResult(async () => {
    const inputs: SvgInput[] = [];
    for (const source of sources) {
      const planned = await planPdfPageConversionInputs<SvgInput>({
        sourcePath: source.sourcePath,
        workspacePath: source.workspacePath,
        workspaceName: source.workspaceName,
        outputTemplate,
        allowedExtensions: ['.svg'],
        ...(runtime.signal !== undefined && { signal: runtime.signal }),
        ...(runtime.reportMessage !== undefined && { report: runtime.reportMessage }),
        toConversion: (page, outputPath) => ({
          sourcePath: source.sourcePath,
          workspacePath: source.workspacePath,
          outputPath,
          page,
        }),
      });
      inputs.push(...planned);
    }
    return convertToSvgFiles({
      inputs,
      maxInputPixels: configuration.maxInputPixels,
      drawioTools: { drawioPath: configuration.drawioPath, runDrawio: executeDrawio },
      runtime,
    });
  }, runtime.signal);
}

async function planPdfPageRasterInputs(
  source: ConversionSource,
  extensions: readonly string[],
  outputTemplate: string,
): Promise<RasterInput[]> {
  const pageCount = await countPdfPages(await readFile(source.sourcePath));
  const selectedPages = source.pages ?? Array.from({ length: pageCount }, (_v, i) => i + 1);
  const { workspacePath, workspaceName } = source;
  return selectedPages.map((page) => ({
    sourcePath: source.sourcePath,
    workspacePath: source.workspacePath,
    outputPath: resolveOutputPath(
      outputTemplate,
      {
        sourcePath: logicalSourcePathForOutputTemplate(source.sourcePath),
        workspacePath,
        workspaceName,
        page: formatOutputPage(page, pageCount),
      },
      { allowedExtensions: extensions },
    ),
    page,
  }));
}
