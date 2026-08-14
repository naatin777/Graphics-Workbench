import * as vscode from 'vscode';

import { convertSinglePdf } from '@graphics-workbench/core/conversion';
import type { Configuration } from '../../generated/extension_manifest.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { toConversionConfiguration, toConversionSources } from '../shared/conversion_adapter.js';

export function outputTemplateForSource(configuration: Configuration): string {
  return configuration.outputPath.single.pdf();
}

export async function convertToPdfCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(userMessage('message.convertToPdf.failed', 'No files were selected.'));
    return;
  }

  await runConversionLifecycle({
    operationName: 'convert-to-pdf',
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: {
      progressTitle: userMessage('message.progress.convertToPdf.title', sourceUris.length),
      prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
      successMessage: (count) => userMessage('message.convertToPdf.success', count),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage('message.convertToPdf.cancelled'),
      failedMessage: (reason) => userMessage('message.convertToPdf.failed', reason),
    },
    run: async (runtime) => {
      const configuration = dependencies.getConfiguration();
      return convertSinglePdf(
        toConversionSources(sourceUris),
        configuration.outputPath.single.pdf(),
        toConversionConfiguration(configuration),
        runtime,
      );
    },
  });
}
