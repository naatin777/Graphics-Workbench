import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import type { CommittedConversionOutput } from '../../operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import {
  createOutputConversionMessages,
  type OutputConversionFormat,
  runConversionLifecycle,
} from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { getCommandConfiguration, selectedUris } from '../shared/command_utils.js';
import { userMessage } from '../shared/user_messages.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import { getMaxAnimationPixels } from '../../config/raster_limits.js';

export interface AnimatedRasterConversionContext<Prepared> {
  configuration: Configuration;
  maxInputPixels: number;
  maxAnimationPixels: number;
  prepared: Prepared;
  runtime: ConversionExecutionContext;
}

export interface AnimatedRasterConversionCommandOptions<Job, Prepared> {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies?: CommandDependencies | undefined;
  operationName: string;
  outputLabel: OutputConversionFormat;
  outputMode?: 'auto' | 'preserve' | 'split';
  prepare: (configuration: Configuration) => Prepared;
  plan: (sourceUri: vscode.Uri, context: AnimatedRasterConversionContext<Prepared>) => Promise<Job[]>;
  execute: (jobs: Job[], context: AnimatedRasterConversionContext<Prepared>) => Promise<CommittedConversionOutput[]>;
}

export async function runAnimatedRasterConversionCommand<Job, Prepared>(
  options: AnimatedRasterConversionCommandOptions<Job, Prepared>,
): Promise<void> {
  const sourceUris = selectedUris(options.uri, options.uris);
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(
      userMessage('message.convertToOutput.failed', options.outputLabel, 'No files were selected.'),
    );
    return;
  }

  const outputChannel = options.dependencies?.outputChannel;
  await runConversionLifecycle({
    operationName: options.operationName,
    ...(outputChannel !== undefined && { outputChannel }),
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages(options.outputLabel, sourceUris.length),
    run: async (runtime) => {
      const configuration = getCommandConfiguration(options.dependencies);
      const maxInputPixels = getMaxInputPixels(configuration);
      const maxAnimationPixels = getMaxAnimationPixels(configuration);
      const prepared = options.prepare(configuration);
      const context = { configuration, maxInputPixels, maxAnimationPixels, prepared, runtime };
      const plannedJobs: Job[] = [];
      for (const sourceUri of sourceUris) {
        runtime.signal?.throwIfAborted();
        plannedJobs.push(...(await options.plan(sourceUri, context)));
      }
      return options.execute(plannedJobs, context);
    },
  });
}
