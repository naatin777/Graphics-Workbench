import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  isRasterFormat,
  sourceFormatForPath,
  type SourceFormat,
} from '@graphics-workbench/core/shared/source_format.js';
import {
  assertExistingPathInWorkspace,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security/workspace_path.js';
import {
  formatRasterInputPixelLimitMessage,
  isRasterInputPixelLimitError,
  openRasterInput,
} from '@graphics-workbench/core/operations/conversion/raster_input.js';

import type {
  CommittedConversionOutput,
  PreparedConversionOutput,
} from '@graphics-workbench/core/operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '@graphics-workbench/core/operations/lifecycle/conversion_runtime.js';
import { runStagedConversionBatch } from '@graphics-workbench/core/operations/lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '@graphics-workbench/core/operations/lifecycle/run_id.js';
import sharp from 'sharp';

export const IMAGE_ROTATION_ANGLES = [90, 180, 270] as const;
export type ImageRotationAngle = (typeof IMAGE_ROTATION_ANGLES)[number];

export interface RotateImageInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  angle: ImageRotationAngle;
}

export interface RotateImageOptions {
  inputs: RotateImageInput[];
  runtime?: ConversionExecutionContext;
  runId?: string;
  maxInputPixels: number;
}

export async function rotateImageFiles(options: RotateImageOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateConversions(options.inputs);
  await validateInputPaths(options.inputs);
  runtime?.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'rotate-image',
    runId: options.runId,
    ...(runtime !== undefined && { runtime }),
    stage: async (input, index, currentRunId, batchRuntime) =>
      rotateImage({
        input,
        index,
        runId: currentRunId,
        signal: batchRuntime.signal,
        maxInputPixels: options.maxInputPixels,
      }),
  });
}

async function rotateImage(params: {
  input: RotateImageInput;
  index: number;
  runId: string;
  signal: AbortSignal;
  maxInputPixels: number;
}): Promise<PreparedConversionOutput> {
  const { input, index, runId, signal, maxInputPixels } = params;
  signal.throwIfAborted();

  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'rotate-image', runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, `result${path.extname(input.outputPath).toLowerCase()}`);

  await assertExistingPathInWorkspace(input.sourcePath, input.workspacePath);
  await assertWritablePathInWorkspace(stageDirectory, input.workspacePath);
  await mkdir(stageDirectory, { recursive: true });
  signal.throwIfAborted();
  await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
  signal.throwIfAborted();

  try {
    await openRasterInput(input.sourcePath, maxInputPixels, undefined, true)
      .rotate(input.angle)
      .toFile(stagedOutputPath);
  } catch (error) {
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
  signal.throwIfAborted();
  await validateGeneratedRaster(stagedOutputPath);
  signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}

function validateConversions(inputs: RotateImageInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No image files were selected.');
  }

  for (const input of inputs) {
    if (!isRasterFormat(sourceFormatForPath(input.sourcePath))) {
      throw new Error(`Only raster image files can be rotated: ${input.sourcePath}`);
    }

    if (!IMAGE_ROTATION_ANGLES.includes(input.angle)) {
      throw new Error(`Unsupported rotation angle: ${input.angle}`);
    }

    if (!isRasterFormat(sourceFormatForPath(input.outputPath))) {
      throw new Error(`Invalid output extension for rotated image: ${input.outputPath}`);
    }
  }
}

async function validateInputPaths(inputs: RotateImageInput[]): Promise<void> {
  await Promise.all(
    inputs.flatMap((input) => [
      assertExistingPathInWorkspace(input.sourcePath, input.workspacePath),
      assertWritablePathInWorkspace(input.outputPath, input.workspacePath),
      assertWritablePathInWorkspace(
        path.join(input.workspacePath, '.graphics-workbench', 'rotate-image'),
        input.workspacePath,
      ),
    ]),
  );
}

async function validateGeneratedRaster(outputPath: string): Promise<void> {
  const metadata = await sharp(outputPath).metadata();
  const expectedFormat = expectedSharpFormat(outputPath);

  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error(`Rotating the image produced invalid output: ${outputPath}`);
  }
}

const sharpFormatBySourceFormat: Partial<Record<SourceFormat, string>> = {
  png: 'png',
  jpeg: 'jpeg',
  webp: 'webp',
  avif: 'heif',
  gif: 'gif',
  tiff: 'tiff',
};

function expectedSharpFormat(outputPath: string): string | undefined {
  const format = sourceFormatForPath(outputPath);
  return format === undefined ? undefined : sharpFormatBySourceFormat[format];
}
