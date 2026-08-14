import * as vscode from 'vscode';

import { convertSinglePdf, convertSplitPdf } from '@graphics-workbench/core/conversion';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import type { LocaleKeyType } from '../../locale_map.js';
import { toConversionConfiguration, toConversionSources } from '../shared/conversion_adapter.js';

export async function convertDrawioToPagePdfsCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioToPdf(sourceUris, dependencies, { split: true });
}

export async function convertDrawioToSinglePdfCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioToPdf(sourceUris, dependencies, { split: false });
}

async function runDrawioToPdf(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  options: { split: boolean },
): Promise<void> {
  const { outputChannel } = dependencies;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage(
      userMessage('message.convertToOutput.failed', 'PDF', 'No files were selected.'),
    );
    return;
  }

  const configuration = dependencies.getConfiguration();
  const split = options.split;
  const operationName = split ? 'convert-drawio-to-pdf' : 'convert-drawio-to-single-pdf';
  const outputTemplate = split ? configuration.outputPath.split.pdf() : configuration.outputPath.single.pdf();
  const messagePrefix: LocaleKeyType = split
    ? 'message.progress.convertDrawioToPagePdfs.title'
    : 'message.progress.convertDrawioToSinglePdf.title';
  const successKey: LocaleKeyType = split
    ? 'message.convertDrawioToPagePdfs.success'
    : 'message.convertDrawioToSinglePdf.success';
  const cancelledKey: LocaleKeyType = split
    ? 'message.convertDrawioToPagePdfs.cancelled'
    : 'message.convertDrawioToSinglePdf.cancelled';
  const failedKey: LocaleKeyType = split
    ? 'message.convertDrawioToPagePdfs.failed'
    : 'message.convertDrawioToSinglePdf.failed';

  await runConversionLifecycle({
    operationName,
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: {
      progressTitle: userMessage(messagePrefix, sourceUris.length),
      prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
      successMessage: (count) => userMessage(successKey, count),
      undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
      cancelledMessage: userMessage(cancelledKey),
      failedMessage: (reason) => userMessage(failedKey, reason),
    },
    run: async (runtime) => {
      const sources = toConversionSources(sourceUris);
      const conversionConfig = toConversionConfiguration(configuration);
      if (split) {
        return convertSplitPdf(sources, outputTemplate, conversionConfig, runtime);
      }
      return convertSinglePdf(sources, outputTemplate, conversionConfig, runtime);
    },
  });
}
