import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import {
  planRasterConversionInputs,
  type PlanRasterConversionInputsOptions,
  type RasterConversionTarget,
  type RasterFormatSpec,
  type RasterInput,
} from '@graphics-workbench/core/conversion';
import { isDrawioImagePath } from '@graphics-workbench/core/formats';
import type { ConversionExecutionContext } from '@graphics-workbench/core/runtime';

import type { LocaleKeyType } from '../../locale_map.js';
import { assertLocalFileUri } from '../shared/command_input.js';
import { userMessage } from '../shared/user_messages.js';

export interface PlanRasterConversionOptions {
  configuration: Configuration;
  maxInputPixels: number;
  maxAnimationPixels?: number;
  /** 'all' splits animated frames into per-frame outputs; otherwise one output per input. */
  frameMode?: 'first' | 'all';
  runtime?: ConversionExecutionContext;
}

export async function planRasterConversionItems(
  sourceUri: vscode.Uri,
  spec: RasterFormatSpec,
  options: PlanRasterConversionOptions,
): Promise<RasterInput[]> {
  assertLocalFileUri(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const inputOptions: PlanRasterConversionInputsOptions = {
    source: {
      sourcePath: sourceUri.fsPath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
    },
    spec,
    outputTemplate: resolveRasterOutputTemplate('single', spec.target, options.configuration),
    splitOutputTemplate: resolveRasterOutputTemplate('split', spec.target, options.configuration),
    frameMode: options.frameMode ?? 'first',
    maxInputPixels: options.maxInputPixels,
    isDrawioImagePath,
  };
  if (options.maxAnimationPixels !== undefined) {
    inputOptions.maxAnimationPixels = options.maxAnimationPixels;
  }
  if (options.runtime !== undefined) {
    if (options.runtime.signal !== undefined) {
      inputOptions.signal = options.runtime.signal;
    }
    inputOptions.report = (message: string) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- コア由来の既知メッセージキーをロケール境界で絞り込む。
      options.runtime?.reportMessage?.(userMessage(message as LocaleKeyType));
    };
  }
  return planRasterConversionInputs(inputOptions);
}

/** Resolves the raster output template from the single/split outputPath settings. */
function resolveRasterOutputTemplate(
  cardinality: 'single' | 'split',
  target: RasterConversionTarget,
  configuration: Configuration,
): string {
  return cardinality === 'split' ? configuration.outputPath.split[target]() : configuration.outputPath.single[target]();
}
