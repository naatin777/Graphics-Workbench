import * as vscode from 'vscode';

import {
  convertSinglePng,
  convertSingleJpeg,
  convertSingleWebp,
  convertSingleAvif,
  convertSingleGif,
  convertSingleTiff,
  convertSplitPng,
  convertSplitJpeg,
  convertSplitWebp,
  convertSplitAvif,
  convertSplitGif,
  convertSplitTiff,
  type ConversionResult,
} from '@graphics-workbench/core/conversion';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { toConversionConfiguration, toConversionSources } from '../shared/conversion_adapter.js';
import type { Configuration } from '../../generated/extension_manifest.js';

export interface ConvertToRasterCommandOptions {
  target: 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff';
  /** アニメーション入力を1ファイルに保持するか、フレームごとに分割するか。 */
  animatedInputMode?: 'single' | 'split';
}

type ImageConverter = (
  sources: ReturnType<typeof toConversionSources>,
  outputTemplate: string,
  configuration: ReturnType<typeof toConversionConfiguration>,
  runtime: Parameters<Parameters<typeof runConversionLifecycle>[0]['run']>[0],
) => Promise<ConversionResult>;

const SINGLE_CONVERTERS = {
  png: convertSinglePng,
  jpeg: convertSingleJpeg,
  webp: convertSingleWebp,
  avif: convertSingleAvif,
  gif: convertSingleGif,
  tiff: convertSingleTiff,
} satisfies Record<ConvertToRasterCommandOptions['target'], ImageConverter>;

const SPLIT_CONVERTERS = {
  png: convertSplitPng,
  jpeg: convertSplitJpeg,
  webp: convertSplitWebp,
  avif: convertSplitAvif,
  gif: convertSplitGif,
  tiff: convertSplitTiff,
} satisfies Record<ConvertToRasterCommandOptions['target'], ImageConverter>;

const TARGET_LABEL = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  gif: 'GIF',
  tiff: 'TIFF',
} as const satisfies Record<ConvertToRasterCommandOptions['target'], string>;

function readOutputTemplate(
  configuration: Configuration,
  target: ConvertToRasterCommandOptions['target'],
  split: boolean,
): string {
  const templates = split ? configuration.outputPath.split : configuration.outputPath.single;
  return templates[target]();
}

export async function convertToRasterCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  options: ConvertToRasterCommandOptions,
): Promise<void> {
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(
      userMessage('message.convertToOutput.failed', TARGET_LABEL[options.target], 'No files were selected.'),
    );
    return;
  }

  const configuration = dependencies.getConfiguration();
  const splitMode = options.animatedInputMode === 'split';
  const converter = splitMode ? SPLIT_CONVERTERS[options.target] : SINGLE_CONVERTERS[options.target];

  await runConversionLifecycle({
    operationName: `${splitMode ? 'split' : 'convert'}-${options.target}`,
    outputChannel: dependencies.outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages(TARGET_LABEL[options.target], sourceUris.length),
    run: async (runtime) =>
      converter(
        toConversionSources(sourceUris),
        readOutputTemplate(configuration, options.target, splitMode),
        toConversionConfiguration(configuration),
        runtime,
      ),
  });
}
