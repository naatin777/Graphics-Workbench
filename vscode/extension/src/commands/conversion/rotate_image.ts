import * as vscode from 'vscode';

import { resolveOutputPath } from '@graphics-workbench/core/output';
import { isRasterImagePath } from '@graphics-workbench/core/formats';
import {
  IMAGE_ROTATION_ANGLES,
  rotateImageFiles,
  toConversionResult,
  type ImageRotationAngle,
  type RotateImageInput,
} from '@graphics-workbench/core/conversion';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';

const RASTER_OUTPUT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.tif', '.tiff'] as const;

export async function rotateImageCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(userMessage('message.rotateImage.failed', 'No image files were selected.'));
    return;
  }

  const angle = await pickRotationAngle();
  if (angle === undefined) {
    return;
  }

  const configuration = dependencies.getConfiguration();
  const outputTemplate = configuration.outputPath.rotateImage();
  const maxInputPixels = configuration.raster.maxInputPixels();
  await runConversionLifecycle({
    operationName: 'rotate-image',
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: {
      progressTitle: userMessage('message.progress.rotateImage.title', sourceUris.length),
      prepareMessage: userMessage('message.progress.prepareRotateImage'),
      successMessage: (count) => userMessage('message.rotateImage.success', count),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage('message.rotateImage.cancelled'),
      failedMessage: (reason) => userMessage('message.rotateImage.failed', reason),
    },
    run: async (runtime) => {
      const inputs = sourceUris.map((sourceUri) => planRotateImageInput(sourceUri, outputTemplate, angle));
      return toConversionResult(async () => rotateImageFiles({ inputs, runtime, maxInputPixels }), runtime.signal);
    },
  });
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
