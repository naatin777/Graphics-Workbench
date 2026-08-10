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
import { resolveSelectedUris } from '../shared/command_input.js';
import { userMessage } from '../shared/user_messages.js';

export interface RasterConversionContext<Prepared> {
  configuration: Configuration;
  maxInputPixels: number;
  maxAnimationPixels?: number;
  prepared: Prepared;
  runtime: ConversionExecutionContext;
}

export interface RasterConversionCommandOptions<Job, Prepared> {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies: CommandDependencies;
  operationName: string;
  outputLabel: OutputConversionFormat;
  animated: boolean;
  prepare: (configuration: Configuration) => Prepared;
  plan: (sourceUri: vscode.Uri, context: RasterConversionContext<Prepared>) => Promise<Job[]>;
  execute: (jobs: Job[], context: RasterConversionContext<Prepared>) => Promise<CommittedConversionOutput[]>;
}

export async function runRasterConversionCommand<Job, Prepared>(
  options: RasterConversionCommandOptions<Job, Prepared>,
): Promise<void> {
  const sourceUris = resolveSelectedUris(options.uri, options.uris);
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(
      userMessage('message.convertToOutput.failed', options.outputLabel, 'No files were selected.'),
    );
    return;
  }

  const outputChannel = options.dependencies.outputChannel;
  await runConversionLifecycle({
    operationName: options.operationName,
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages(options.outputLabel, sourceUris.length),
    run: async (runtime) => {
      const configuration = options.dependencies.getConfiguration();
      const maxInputPixels = configuration.raster.maxInputPixels();
      const prepared = options.prepare(configuration);
      const context: RasterConversionContext<Prepared> = {
        configuration,
        maxInputPixels,
        prepared,
        runtime,
        ...(options.animated && { maxAnimationPixels: configuration.raster.maxAnimationPixels() }),
      };
      const plannedJobs: Job[] = [];
      for (const sourceUri of sourceUris) {
        runtime.signal?.throwIfAborted();
        plannedJobs.push(...(await options.plan(sourceUri, context)));
      }
      return options.execute(plannedJobs, context);
    },
  });
}
