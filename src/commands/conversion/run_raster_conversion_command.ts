import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import type { CommittedConversionOutput } from '../../operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { getMaxAnimationPixels } from '../../config/raster_limits.js';
import { getMaxInputPixels } from '../../config/raster_input.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import {
  createOutputConversionMessages,
  type OutputConversionFormat,
  runConversionLifecycle,
} from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { resolveSelectedUris } from '../shared/command_input.js';
import { userMessage } from '../shared/user_messages.js';

export interface RasterConversionContext<Prepared> {
  configuration: Configuration;
  maxInputPixels: number;
  prepared: Prepared;
  runtime: ConversionExecutionContext;
}

export interface AnimatedRasterConversionContext<Prepared> extends RasterConversionContext<Prepared> {
  maxAnimationPixels: number;
}

interface RasterConversionCommandOptions<Context, Job, Prepared> {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies?: CommandDependencies | undefined;
  operationName: string;
  outputLabel: OutputConversionFormat;
  prepare: (configuration: Configuration) => Prepared;
  createContext: (base: RasterConversionContext<Prepared>) => Context;
  plan: (sourceUri: vscode.Uri, context: Context) => Promise<Job[]>;
  execute: (jobs: Job[], context: Context) => Promise<CommittedConversionOutput[]>;
}

async function runRasterConversionCommand<Context, Job, Prepared>(
  options: RasterConversionCommandOptions<Context, Job, Prepared>,
): Promise<void> {
  const sourceUris = resolveSelectedUris(options.uri, options.uris);
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
      const configuration = configureCommandRuntime(options.dependencies);
      const maxInputPixels = getMaxInputPixels(configuration);
      const prepared = options.prepare(configuration);
      const context = options.createContext({ configuration, maxInputPixels, prepared, runtime });
      const plannedJobs: Job[] = [];
      for (const sourceUri of sourceUris) {
        runtime.signal?.throwIfAborted();
        plannedJobs.push(...(await options.plan(sourceUri, context)));
      }
      return options.execute(plannedJobs, context);
    },
  });
}

export interface SimpleRasterConversionCommandOptions<Job, Prepared> {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies?: CommandDependencies | undefined;
  operationName: string;
  outputLabel: OutputConversionFormat;
  prepare: (configuration: Configuration) => Prepared;
  plan: (sourceUri: vscode.Uri, context: RasterConversionContext<Prepared>) => Promise<Job[]>;
  execute: (jobs: Job[], context: RasterConversionContext<Prepared>) => Promise<CommittedConversionOutput[]>;
}

export async function runSimpleRasterConversionCommand<Job, Prepared>(
  options: SimpleRasterConversionCommandOptions<Job, Prepared>,
): Promise<void> {
  return runRasterConversionCommand({
    uri: options.uri,
    uris: options.uris,
    dependencies: options.dependencies,
    operationName: options.operationName,
    outputLabel: options.outputLabel,
    prepare: options.prepare,
    createContext: (base) => base,
    plan: options.plan,
    execute: options.execute,
  });
}

export interface AnimatedRasterConversionCommandOptions<Job, Prepared> {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies?: CommandDependencies | undefined;
  operationName: string;
  outputLabel: OutputConversionFormat;
  prepare: (configuration: Configuration) => Prepared;
  plan: (sourceUri: vscode.Uri, context: AnimatedRasterConversionContext<Prepared>) => Promise<Job[]>;
  execute: (jobs: Job[], context: AnimatedRasterConversionContext<Prepared>) => Promise<CommittedConversionOutput[]>;
}

export async function runAnimatedRasterConversionCommand<Job, Prepared>(
  options: AnimatedRasterConversionCommandOptions<Job, Prepared>,
): Promise<void> {
  return runRasterConversionCommand({
    uri: options.uri,
    uris: options.uris,
    dependencies: options.dependencies,
    operationName: options.operationName,
    outputLabel: options.outputLabel,
    prepare: options.prepare,
    createContext: (base) => ({
      ...base,
      maxAnimationPixels: getMaxAnimationPixels(base.configuration),
    }),
    plan: options.plan,
    execute: options.execute,
  });
}
