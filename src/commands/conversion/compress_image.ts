import path from 'node:path';

import * as vscode from 'vscode';

import { assertAnimationPixelLimit } from '../../config/raster.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import {
  compressImageFiles,
  compressibleFormatForPath,
  type CompressImageInput,
  type CompressibleImageFormat,
} from '../../operations/conversion/compress_image.js';
import { readRasterAnimationMetadata } from '../../operations/conversion/raster_input.js';
import { isAbortError } from '../../shared/error.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';

const OPERATION_NAME = 'compress-image';

const animatedCompressionFormats = new Set<CompressibleImageFormat>(['gif', 'webp']);

export async function compressImageCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  try {
    if (sourceUris.length === 0) {
      throw new Error('No image files were selected.');
    }

    const configuration = dependencies.getConfiguration();
    const outputTemplate = configuration.outputPath.compressImage();
    const quality = configuration.compressImage.quality();
    const maxInputPixels = configuration.raster.maxInputPixels();
    const maxAnimationPixels = configuration.raster.maxAnimationPixels();
    const inputs: CompressImageInput[] = [];
    for (const sourceUri of sourceUris) {
      inputs.push(...(await planCompressImageInputs(sourceUri, outputTemplate, maxInputPixels, maxAnimationPixels)));
    }

    await runConversionLifecycle({
      operationName: OPERATION_NAME,
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.compressImage.title', inputs.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'Image'),
        successMessage: (count) => userMessage('message.compressImage.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.compressImage.cancelled'),
        failedMessage: (reason) => userMessage('message.compressImage.failed', reason),
      },
      run: async (runtime) => compressImageFiles({ inputs, quality, maxInputPixels, runtime }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.compressImage.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.compressImage.failed', message));
  }
}

async function planCompressImageInputs(
  sourceUri: vscode.Uri,
  outputTemplate: string,
  maxInputPixels: number,
  maxAnimationPixels: number,
): Promise<CompressImageInput[]> {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local image files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The image must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const format = compressibleFormatForPath(sourcePath);
  if (format === undefined) {
    throw new Error(`Unsupported input for image compression: ${sourcePath}`);
  }

  const outputPath = resolveOutputPath(
    outputTemplate,
    {
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      sourcePath,
    },
    { allowedExtensions: [path.extname(sourcePath)] },
  );

  const animation = animatedCompressionFormats.has(format)
    ? await readRasterAnimationMetadata(sourcePath, maxInputPixels)
    : undefined;
  if (animation !== undefined) {
    assertAnimationPixelLimit(
      animation.width ?? 0,
      animation.pageHeight,
      animation.pages,
      maxAnimationPixels,
      sourcePath,
    );
  }

  return [
    {
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      outputPath,
      ...(animation !== undefined && { animation }),
    },
  ];
}
