import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isDrawioImagePath,
  isNativeDrawioPath,
  type RASTER_FORMATS,
  isSameSourceFormat,
  sourceFormatForPath,
} from '../../shared/source_format.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { countPdfPages, hasPdfPageContent } from '../pdf/mupdf.js';

import {
  isRasterInputPixelLimitError,
  formatRasterInputPixelLimitMessage,
  openRasterInput,
  rasterAnimationEncoderOptions,
  type RasterAnimationMetadata,
} from './raster_input.js';
// oxlint-disable-next-line unicorn/prefer-export-from -- CommittedConversionOutput is used locally and re-exported.
import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';

export type { CommittedConversionOutput };
import type { ConversionExecutionContext, ResolvedConversionRuntime } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend } from './tools/drawio_tools.js';
import type { PdfRenderBackend } from './tools/pdf_render_tools.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import sharp from 'sharp';

export type RasterConversionTarget = (typeof RASTER_FORMATS)[number];

export interface RasterFormatSpec {
  target: RasterConversionTarget;
  operationName: string;
  label: 'PNG' | 'JPEG' | 'AVIF' | 'TIFF' | 'WebP' | 'GIF';
  extensions: readonly string[];
  animatedInputExtension?: string;
}

export const rasterFormatSpecs = {
  png: {
    target: 'png',
    operationName: 'convert-to-png',
    extensions: ['.png'],
    label: 'PNG',
  },
  jpeg: {
    target: 'jpeg',
    operationName: 'convert-to-jpeg',
    extensions: ['.jpg', '.jpeg'],
    label: 'JPEG',
  },
  avif: {
    target: 'avif',
    operationName: 'convert-to-avif',
    extensions: ['.avif'],
    label: 'AVIF',
  },
  tiff: {
    target: 'tiff',
    operationName: 'convert-to-tiff',
    extensions: ['.tif', '.tiff'],
    label: 'TIFF',
  },
  webp: {
    target: 'webp',
    operationName: 'convert-to-webp',
    extensions: ['.webp'],
    label: 'WebP',
    animatedInputExtension: '.gif',
  },
  gif: {
    target: 'gif',
    operationName: 'convert-to-gif',
    extensions: ['.gif'],
    label: 'GIF',
    animatedInputExtension: '.webp',
  },
} as const satisfies Record<RasterConversionTarget, RasterFormatSpec>;

export interface RasterInput {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
  animation?: RasterAnimationMetadata;
}

interface RasterStageContext {
  runId: string;
  runtime: ResolvedConversionRuntime;
  pdfRenderTools: PdfRenderBackend;
  drawioTools: DrawioBackend | undefined;
  spec: RasterFormatSpec;
  outputOptions?: AvifOutputOptions | WebpOutputOptions;
  maxInputPixels: number;
}

interface RasterStagePaths {
  stageDirectory: string;
  stagedOutputPath: string;
  stagingRootPath: string;
}

interface RasterRenderRequest {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  stageDirectory?: string;
  page?: number;
  animation?: RasterAnimationMetadata;
  cropContent?: boolean;
}

async function stageRasterConversion(
  input: RasterInput,
  index: number,
  context: RasterStageContext,
): Promise<PreparedConversionOutput> {
  context.runtime.signal.throwIfAborted();
  const resultExtension = context.spec.target;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, context.spec.operationName, context.runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, `result.${resultExtension}`);

  await writeSourceAsRaster(input, { stageDirectory, stagedOutputPath, stagingRootPath }, context);
  context.runtime.signal.throwIfAborted();
  await validateGeneratedRaster(stagedOutputPath, resultExtension);
  context.runtime.signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}

async function writeSourceAsRaster(
  input: RasterInput,
  paths: RasterStagePaths,
  context: RasterStageContext,
): Promise<void> {
  const { sourcePath } = input;
  const extension = path.extname(sourcePath).toLowerCase();

  if (isDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    await writeDrawioAsRaster(input, paths, context);
    return;
  }

  const request: RasterRenderRequest = {
    sourcePath,
    outputPath: paths.stagedOutputPath,
    workspacePath: input.workspacePath,
    stageDirectory: paths.stageDirectory,
  };
  if (input.page !== undefined) {
    request.page = input.page;
  }
  if (input.animation !== undefined) {
    request.animation = input.animation;
  }

  if (extension === '.pdf') {
    await writePdfPageAsRaster(request, context);
    return;
  }

  await writeImageAsRaster(request, context);
}

async function writeDrawioAsRaster(
  input: RasterInput,
  paths: RasterStagePaths,
  context: RasterStageContext,
): Promise<void> {
  if (context.drawioTools === undefined) {
    throw new Error('Draw.io backend is unavailable for this frontend.');
  }

  context.runtime.signal.throwIfAborted();
  const pdfPath = path.join(paths.stageDirectory, 'drawio.pdf');
  await assertWritablePathInWorkspace(pdfPath, input.workspacePath);
  await mkdir(path.dirname(pdfPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  await context.drawioTools.runDrawio(
    context.drawioTools.drawioPath,
    ['-x', '-f', 'pdf', '-o', pdfPath, input.sourcePath],
    context.runtime.signal,
  );

  // Draw.io PDF exports leave white margins even with --crop, so crop each
  // page to its drawn content. Without an explicit page, use the first page
  // that actually contains content. The page scan needs a real PDF.
  const pdfBytes = await readFile(pdfPath);
  let page = input.page ?? 1;
  if (input.page === undefined) {
    const pageCount = await countPdfPages(pdfBytes);
    for (let candidate = 1; candidate <= pageCount; candidate += 1) {
      context.runtime.signal.throwIfAborted();
      if (await hasPdfPageContent(pdfBytes, candidate)) {
        page = candidate;
        break;
      }
    }
  }

  await writePdfPageAsRaster(
    {
      sourcePath: pdfPath,
      outputPath: paths.stagedOutputPath,
      workspacePath: input.workspacePath,
      stageDirectory: paths.stageDirectory,
      page,
      cropContent: true,
    },
    context,
  );
}

async function writePdfPageAsRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  const pngPath = path.join(request.stageDirectory ?? path.dirname(request.outputPath), 'source.png');
  context.runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(pngPath, request.workspacePath);
  await mkdir(path.dirname(pngPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  await context.pdfRenderTools.runPdfToPng(
    request.sourcePath,
    pngPath,
    request.page ?? 1,
    context.runtime.signal,
    request.cropContent,
  );
  context.runtime.signal.throwIfAborted();

  await writeImageAsRaster({ ...request, sourcePath: pngPath }, context);
}

async function writeImageAsRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  context.runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(request.outputPath, request.workspacePath);
  await mkdir(path.dirname(request.outputPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  try {
    await encodeRaster(request, context);
  } catch (error) {
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(context.maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function encodeRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  const input = openRasterInput(
    request.sourcePath,
    context.maxInputPixels,
    request.page,
    request.animation !== undefined,
  );

  switch (context.spec.target) {
    case 'png': {
      await input.png().toFile(request.outputPath);
      return;
    }
    case 'jpeg': {
      await input.jpeg().toFile(request.outputPath);
      return;
    }
    case 'tiff': {
      await input.tiff().toFile(request.outputPath);
      return;
    }
    case 'avif': {
      await input.avif(context.outputOptions).toFile(request.outputPath);
      return;
    }
    case 'gif': {
      await input.gif(rasterAnimationEncoderOptions(request.animation)).toFile(request.outputPath);
      return;
    }
    case 'webp': {
      await input
        .webp({ ...context.outputOptions, ...rasterAnimationEncoderOptions(request.animation) })
        .toFile(request.outputPath);
    }
  }
}

async function validateInputPaths(inputs: RasterInput[], stagingDirectoryName: string): Promise<void> {
  await Promise.all(
    inputs.flatMap((input) => [
      assertExistingPathInWorkspace(input.sourcePath, input.workspacePath),
      assertWritablePathInWorkspace(input.outputPath, input.workspacePath),
      assertWritablePathInWorkspace(
        path.join(input.workspacePath, '.graphics-workbench', stagingDirectoryName),
        input.workspacePath,
      ),
    ]),
  );
}

function validateConversions(inputs: RasterInput[], spec: RasterFormatSpec): void {
  if (inputs.length === 0) {
    throw new Error('No files were selected.');
  }

  for (const input of inputs) {
    if (
      !isDrawioImagePath(input.sourcePath) &&
      !isNativeDrawioPath(input.sourcePath) &&
      isSameSourceFormat(input.sourcePath, spec.target)
    ) {
      throw new Error(`Input and output formats must differ: ${input.sourcePath}`);
    }

    if (!isSupportedSourcePath(input.sourcePath)) {
      throw new Error(`Unsupported input for ${spec.label} input: ${input.sourcePath}`);
    }
  }
}

async function validateGeneratedRaster(outputPath: string, outputExtension: string): Promise<void> {
  const metadata = await sharp(outputPath).metadata();
  const expectedFormat = outputExtension === 'avif' ? 'heif' : outputExtension;

  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error(`Raster input produced invalid ${outputExtension.toUpperCase()} output: ${outputPath}`);
  }
}

function isSupportedSourcePath(sourcePath: string): boolean {
  return sourceFormatForPath(sourcePath) !== undefined;
}

interface AvifOutputOptions {
  effort: number;
}

interface WebpOutputOptions {
  effort: number;
}

export interface ExecuteRasterConversionOptions {
  inputs: RasterInput[];
  runtime: ConversionExecutionContext;
  pdfRenderTools: PdfRenderBackend;
  drawioTools?: DrawioBackend;
  maxInputPixels: number;
  runId?: string;
  spec: RasterFormatSpec;
  outputOptions?: AvifOutputOptions | WebpOutputOptions;
}

export async function executeRasterConversion(
  options: ExecuteRasterConversionOptions,
): Promise<CommittedConversionOutput[]> {
  options.runtime.signal?.throwIfAborted();
  validateConversions(options.inputs, options.spec);
  await validateInputPaths(options.inputs, options.spec.operationName);
  options.runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: options.spec.operationName,
    runId: options.runId,
    runtime: options.runtime,
    stage: async (input, index, stageRunId, stageRuntime) =>
      stageRasterConversion(input, index, {
        runId: stageRunId,
        runtime: stageRuntime,
        pdfRenderTools: options.pdfRenderTools,
        drawioTools: options.drawioTools,
        spec: options.spec,
        ...(options.outputOptions !== undefined && { outputOptions: options.outputOptions }),
        maxInputPixels: options.maxInputPixels,
      }),
  });
}
