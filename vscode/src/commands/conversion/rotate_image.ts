import * as vscode from 'vscode';

import { resolveOutputPath } from '@graphics-workbench/core/config/output/resolve_output_path.js';
import { isRasterImagePath } from '@graphics-workbench/core/shared/source_format.js';
import {
  IMAGE_ROTATION_ANGLES,
  rotateImageFiles,
  type ImageRotationAngle,
  type RotateImageInput,
} from '../../operations/conversion/rotate_image.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { isAbortError } from '@graphics-workbench/core/shared/error.js';

const RASTER_OUTPUT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.tif', '.tiff'] as const;

export async function rotateImageCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  try {
    if (sourceUris.length === 0) {
      throw new Error('No image files were selected.');
    }

    const angle = await pickRotationAngle();

    if (angle === undefined) {
      return;
    }

    const configuration = dependencies.getConfiguration();
    const outputTemplate = configuration.outputPath.rotateImage();
    const maxInputPixels = configuration.raster.maxInputPixels();
    const inputs = sourceUris.map((sourceUri) => planRotateImageInput(sourceUri, outputTemplate, angle));
    await runConversionLifecycle({
      operationName: 'rotate-image',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.rotateImage.title', inputs.length),
        prepareMessage: userMessage('message.progress.prepareRotateImage'),
        successMessage: (count) => userMessage('message.rotateImage.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.rotateImage.cancelled'),
        failedMessage: (reason) => userMessage('message.rotateImage.failed', reason),
      },
      run: async (runtime) => rotateImageFiles({ inputs, runtime, maxInputPixels }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.rotateImage.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.rotateImage.failed', message));
  }
}

async function pickRotationAngle(): Promise<ImageRotationAngle | undefined> {
  const items = IMAGE_ROTATION_ANGLES.map((angle) => ({ label: `${angle}°`, angle }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: userMessage('message.rotateImage.pickAngle'),
  });
  return selected?.angle;
}

function planRotateImageInput(
  sourceUri: vscode.Uri,
  outputTemplate: string,
  angle: ImageRotationAngle,
): RotateImageInput {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local image files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The image must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (!isRasterImagePath(sourcePath)) {
    throw new Error(`Only raster image files can be rotated: ${sourcePath}`);
  }

  return {
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    outputPath: resolveOutputPath(
      outputTemplate,
      {
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
        sourcePath,
      },
      { allowedExtensions: RASTER_OUTPUT_EXTENSIONS },
    ),
    angle,
  };
}
