import * as vscode from 'vscode';

import { convertSingleSvg, convertSplitSvg } from '@graphics-workbench/core/conversion';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { toConversionConfiguration, toConversionSources } from '../shared/conversion_adapter.js';

export async function convertToSvgCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage('No files were selected.');
    return;
  }

  const configuration = dependencies.getConfiguration();
  const hasPdfSource = sourceUris.some((uri) => uri.fsPath.toLowerCase().endsWith('.pdf'));

  await runConversionLifecycle({
    operationName: 'convert-to-svg',
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages('SVG', sourceUris.length),
    run: async (runtime) => {
      const sources = toConversionSources(sourceUris);
      const conversionConfig = toConversionConfiguration(configuration);
      if (hasPdfSource) {
        return convertSplitSvg(sources, configuration.outputPath.split.svg(), conversionConfig, runtime);
      }
      return convertSingleSvg(sources, configuration.outputPath.single.svg(), conversionConfig, runtime);
    },
  });
}
