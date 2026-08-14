import * as vscode from 'vscode';

import { convertSingleDrawio } from '@graphics-workbench/core/conversion';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { toConversionConfiguration, toConversionSources } from '../shared/conversion_adapter.js';

export async function convertToDrawioCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(sourceUris, dependencies, 'drawio');
}

export async function convertToDrawioPngCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(sourceUris, dependencies, 'drawioPng');
}

export async function convertToDrawioSvgCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(sourceUris, dependencies, 'drawioSvg');
}

async function runDrawioConversionCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  outputKind: 'drawio' | 'drawioPng' | 'drawioSvg',
): Promise<void> {
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage('No files were selected.');
    return;
  }

  const configuration = dependencies.getConfiguration();
  const outputTemplate = configuration.outputPath.single[outputKind]();

  await runConversionLifecycle({
    operationName: 'convert-to-drawio',
    outputChannel: dependencies.outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages('Draw.io', sourceUris.length),
    run: async (runtime) => {
      const sources = toConversionSources(sourceUris);
      return convertSingleDrawio(sources, outputTemplate, toConversionConfiguration(configuration), runtime);
    },
  });
}
