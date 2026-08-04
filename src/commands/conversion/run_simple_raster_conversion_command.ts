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
import { getCommandConfiguration, isAbortError, selectedUris } from '../shared/command_utils.js';
import { userMessage } from '../shared/user_messages.js';
import { getMaxInputPixels } from '../../config/raster_input.js';

export interface SimpleRasterConversionContext<Prepared> {
  configuration: Configuration;
  maxInputPixels: number;
  prepared: Prepared;
  runtime: ConversionExecutionContext;
}

export interface SimpleRasterConversionCommandOptions<Job, Prepared> {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies?: CommandDependencies | undefined;
  operationName: string;
  outputLabel: OutputConversionFormat;
  prepare: (configuration: Configuration, maxInputPixels: number) => Prepared;
  plan: (sourceUri: vscode.Uri, context: SimpleRasterConversionContext<Prepared>) => Promise<Job[]>;
  execute: (jobs: Job[], context: SimpleRasterConversionContext<Prepared>) => Promise<CommittedConversionOutput[]>;
}

export async function runSimpleRasterConversionCommand<Job, Prepared>(
  options: SimpleRasterConversionCommandOptions<Job, Prepared>,
): Promise<void> {
  const outputChannel = options.dependencies?.outputChannel;

  try {
    const sourceUris = selectedUris(options.uri, options.uris);
    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }

    const configuration = getCommandConfiguration(options.dependencies);
    const maxInputPixels = getMaxInputPixels(configuration);
    const prepared = options.prepare(configuration, maxInputPixels);

    await runConversionLifecycle({
      operationName: options.operationName,
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages(options.outputLabel, sourceUris.length),
      run: async (runtime) => {
        const context = { configuration, maxInputPixels, prepared, runtime };
        const plannedJobs = await Promise.all(sourceUris.map(async (sourceUri) => options.plan(sourceUri, context)));
        return options.execute(plannedJobs.flat(), context);
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', options.outputLabel));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', options.outputLabel, message));
  }
}
