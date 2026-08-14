import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sourceFormatForPath } from '../../shared/source_format.js';
import { assertAnimationPixelLimit } from './animation_pixel_limit.js';
import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext, ResolvedConversionRuntime } from '../lifecycle/conversion_runtime.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import sharp from 'sharp';

import {
  closeRasterPipeline,
  formatRasterInputPixelLimitMessage,
  isRasterInputPixelLimitError,
  openRasterInput,
  readRasterAnimationMetadata,
  rasterAnimationEncoderOptions,
  type RasterAnimationMetadata,
} from './raster_input.js';

const OPERATION_NAME = 'compress-image';

export type CompressibleImageFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff';

/** 圧縮対応フォーマットのみ返す。非対応のラスタ以外はundefined。 */
export function compressibleFormatForPath(sourcePath: string): CompressibleImageFormat | undefined {
  const format = sourceFormatForPath(sourcePath);
  if (format === undefined) {
    return undefined;
  }

  switch (format) {
    case 'png':
    case 'jpeg':
    case 'webp':
    case 'avif':
    case 'gif':
    case 'tiff': {
      return format;
    }
    case 'pdf':
    case 'svg':
    case 'drawio':
    case 'drawio-png':
    case 'drawio-svg': {
      return undefined;
    }
  }

  return undefined;
}

export interface CompressImageInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  animation?: RasterAnimationMetadata;
}

export interface CompressImageOptions {
  inputs: CompressImageInput[];
  quality: number;
  maxInputPixels: number;
  /** Aggregate animated-input pixel limit (width * pageHeight * frameCount); always enforced before staging. */
  maxAnimationPixels: number;
  runtime: ConversionExecutionContext;
  runId?: string;
}

export async function compressImageFiles(options: CompressImageOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime.signal?.throwIfAborted();
  validateConversions(options.inputs);
  await validateInputPaths(options.inputs);
  runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: OPERATION_NAME,
    runId: options.runId,
    runtime,
    stage: async (input, index, stageRunId, stageRuntime) =>
      stageCompressImage(input, index, {
        runId: stageRunId,
        runtime: stageRuntime,
        quality: options.quality,
        maxInputPixels: options.maxInputPixels,
        maxAnimationPixels: options.maxAnimationPixels,
      }),
  });
}

interface CompressImageStageContext {
  runId: string;
  runtime: ResolvedConversionRuntime;
  quality: number;
  maxInputPixels: number;
  maxAnimationPixels: number;
}

interface CompressImageStagePaths {
  stageDirectory: string;
  stagedOutputPath: string;
  stagingRootPath: string;
}

interface CompressImageRenderRequest {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  animation?: RasterAnimationMetadata;
}

async function stageCompressImage(
  input: CompressImageInput,
  index: number,
  context: CompressImageStageContext,
): Promise<PreparedConversionOutput> {
  context.runtime.signal.throwIfAborted();
  const animation =
    input.animation ??
    (compressibleFormatForPath(input.sourcePath) === 'tiff'
      ? await readRasterAnimationMetadata(input.sourcePath, context.maxInputPixels)
      : undefined);
  if (animation !== undefined) {
    assertAnimationPixelLimit(
      animation.width ?? 0,
      animation.pageHeight,
      animation.pages,
      context.maxAnimationPixels,
      input.sourcePath,
    );
  }
  context.runtime.signal.throwIfAborted();
  const plannedInput = animation === undefined ? input : { ...input, animation };
  const resultExtension = path.extname(input.sourcePath).toLowerCase().replace(/^\./u, '');
  const stagingRootPath = stagingRootPathFor(input.workspacePath, OPERATION_NAME, context.runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, `result.${resultExtension}`);

  await writeCompressedImage(plannedInput, { stageDirectory, stagedOutputPath, stagingRootPath }, context);
  context.runtime.signal.throwIfAborted();
  await validateGeneratedImage(stagedOutputPath, compressibleFormatForPath(input.sourcePath), plannedInput.animation);
  context.runtime.signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}

async function writeCompressedImage(
  input: CompressImageInput,
  paths: CompressImageStagePaths,
  context: CompressImageStageContext,
): Promise<void> {
  context.runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(paths.stagedOutputPath, input.workspacePath);
  await mkdir(path.dirname(paths.stagedOutputPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  const request: CompressImageRenderRequest = {
    sourcePath: input.sourcePath,
    outputPath: paths.stagedOutputPath,
    workspacePath: input.workspacePath,
  };
  if (input.animation !== undefined) {
    request.animation = input.animation;
  }

  try {
    await encodeCompressedImage(request, context);
  } catch (error) {
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(context.maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function encodeCompressedImage(
  request: CompressImageRenderRequest,
  context: CompressImageStageContext,
): Promise<void> {
  const format = compressibleFormatForPath(request.sourcePath);
  if (format === undefined) {
    throw new Error(`Unsupported input for image compression: ${request.sourcePath}`);
  }

  if (format === 'tiff' && request.animation !== undefined && request.animation.pages > 1) {
    await encodeMultipageTiff(request, context, request.animation.pages);
    return;
  }

  const input = openRasterInput(request.sourcePath, context.maxInputPixels, undefined, request.animation !== undefined);
  try {
    switch (format) {
      case 'png': {
        await input.png({ compressionLevel: 9, effort: 10 }).toFile(request.outputPath);
        return;
      }
      case 'jpeg': {
        await input.jpeg({ quality: context.quality, mozjpeg: true }).toFile(request.outputPath);
        return;
      }
      case 'webp': {
        await input
          .webp({ quality: context.quality, effort: 4, ...rasterAnimationEncoderOptions(request.animation) })
          .toFile(request.outputPath);
        return;
      }
      case 'avif': {
        await input.avif({ quality: context.quality, effort: 4 }).toFile(request.outputPath);
        return;
      }
      case 'gif': {
        await input.gif({ effort: 10, ...rasterAnimationEncoderOptions(request.animation) }).toFile(request.outputPath);
        return;
      }
      case 'tiff': {
        await input.tiff({ compression: 'lzw' }).toFile(request.outputPath);
        return;
      }
      default: {
        throw new Error(`Unsupported input for image compression: ${request.sourcePath}`);
      }
    }
  } finally {
    await closeRasterPipeline(input);
  }
}

async function encodeMultipageTiff(
  request: CompressImageRenderRequest,
  context: CompressImageStageContext,
  pages: number,
): Promise<void> {
  const pageBuffers: Buffer[] = [];
  const pageNumbers = Array.from({ length: pages }, (_unused, index) => index + 1);
  // oxlint-disable-next-line no-unreachable-loop -- Each iteration decodes a distinct TIFF page.
  for (const page of pageNumbers) {
    context.runtime.signal.throwIfAborted();
    const input = openRasterInput(request.sourcePath, context.maxInputPixels, page);
    try {
      pageBuffers.push(await input.png().toBuffer());
    } finally {
      await closeRasterPipeline(input);
    }
  }
  context.runtime.signal.throwIfAborted();
  await sharp(pageBuffers, { join: { animated: true } })
    .tiff({ compression: 'lzw' })
    .toFile(request.outputPath);
}

async function validateGeneratedImage(
  outputPath: string,
  format: CompressibleImageFormat | undefined,
  animation: RasterAnimationMetadata | undefined,
): Promise<void> {
  if (format === undefined) {
    throw new Error(`Unsupported input for image compression: ${outputPath}`);
  }

  const metadata = await sharp(outputPath).metadata();
  const expectedFormat = format === 'avif' ? 'heif' : format;

  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error(`Image compression produced invalid ${expectedFormat.toUpperCase()} output: ${outputPath}`);
  }
  if (animation !== undefined && (metadata.pages ?? 1) !== animation.pages) {
    throw new Error(
      `Image compression produced ${metadata.pages ?? 1} pages instead of ${animation.pages}: ${outputPath}`,
    );
  }
}

function validateConversions(inputs: CompressImageInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No image files were selected.');
  }

  for (const input of inputs) {
    if (compressibleFormatForPath(input.sourcePath) === undefined) {
      throw new Error(`Unsupported input for image compression: ${input.sourcePath}`);
    }
  }
}

async function validateInputPaths(inputs: CompressImageInput[]): Promise<void> {
  await Promise.all(
    inputs.flatMap((input) => [
      assertExistingPathInWorkspace(input.sourcePath, input.workspacePath),
      assertWritablePathInWorkspace(input.outputPath, input.workspacePath),
      assertWritablePathInWorkspace(
        path.join(input.workspacePath, '.graphics-workbench', OPERATION_NAME),
        input.workspacePath,
      ),
    ]),
  );
}
