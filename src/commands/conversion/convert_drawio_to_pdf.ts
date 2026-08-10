import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import { isDrawioPath } from '../../shared/source_format.js';
import { assertPageTemplateForSplitOutput } from '../../config/output/page_template.js';
import type { CommittedConversionOutput } from '../../operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import {
  convertDrawioToPagePdfs,
  convertDrawioToSinglePdf,
  type DrawioPdfInput,
} from '../../operations/conversion/convert_drawio_to_pdf.js';
import { executeDrawio } from '../../operations/conversion/tools/drawio_tools.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import type { LocaleKeyType } from '../../locale_map.js';

export async function convertDrawioToPagePdfsCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioToPdfLifecycle(sourceUris, dependencies, {
    operationName: 'convert-drawio-to-pdf',
    readTemplate: (configuration) => configuration.outputPath.split.pdf(),
    validateTemplate: (template) => {
      assertPageTemplateForSplitOutput(template, 2);
    },
    messageKeys: {
      progressTitle: 'message.progress.convertDrawioToPagePdfs.title',
      success: 'message.convertDrawioToPagePdfs.success',
      cancelled: 'message.convertDrawioToPagePdfs.cancelled',
      failed: 'message.convertDrawioToPagePdfs.failed',
    },
    run: async (inputs, drawioPath, runtime) =>
      convertDrawioToPagePdfs({ inputs, drawioPath, runDrawio: executeDrawio, runtime }),
  });
}

export async function convertDrawioToSinglePdfCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioToPdfLifecycle(sourceUris, dependencies, {
    operationName: 'convert-drawio-to-single-pdf',
    readTemplate: (configuration) => configuration.outputPath.single.pdf(),
    messageKeys: {
      progressTitle: 'message.progress.convertDrawioToSinglePdf.title',
      success: 'message.convertDrawioToSinglePdf.success',
      cancelled: 'message.convertDrawioToSinglePdf.cancelled',
      failed: 'message.convertDrawioToSinglePdf.failed',
    },
    run: async (inputs, drawioPath, runtime) =>
      convertDrawioToSinglePdf({ inputs, drawioPath, runDrawio: executeDrawio, runtime }),
  });
}

async function runDrawioToPdfLifecycle(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  options: {
    operationName: string;
    readTemplate: (configuration: Configuration) => string;
    validateTemplate?: (template: string) => void;
    messageKeys: {
      progressTitle: LocaleKeyType;
      success: LocaleKeyType;
      cancelled: LocaleKeyType;
      failed: LocaleKeyType;
    };
    run: (
      inputs: DrawioPdfInput[],
      drawioPath: string,
      runtime: ConversionExecutionContext,
    ) => Promise<CommittedConversionOutput[]>;
  },
): Promise<void> {
  try {
    if (sourceUris.length === 0) {
      throw new Error('No Draw.io files were selected.');
    }

    const configuration = dependencies.getConfiguration();
    const outputTemplate = options.readTemplate(configuration);
    options.validateTemplate?.(outputTemplate);
    const inputs = sourceUris.map((sourceUri) => planDrawioPdfInput(sourceUri, outputTemplate));
    const drawioPath = configuration.execPath.drawio();

    await runConversionLifecycle({
      operationName: options.operationName,
      outputChannel: dependencies.outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage(options.messageKeys.progressTitle, inputs.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'Draw.io PDF'),
        successMessage: (count) => userMessage(options.messageKeys.success, count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage(options.messageKeys.cancelled),
        failedMessage: (reason) => userMessage(options.messageKeys.failed, reason),
      },
      run: async (runtime) => options.run(inputs, drawioPath, runtime),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage(options.messageKeys.failed, message));
  }
}

function planDrawioPdfInput(sourceUri: vscode.Uri, outputTemplate: string): DrawioPdfInput {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local Draw.io files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The Draw.io file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  if (!isDrawioPath(sourceUri.fsPath)) {
    throw new Error(`Only Draw.io files are supported: ${sourceUri.fsPath}`);
  }

  return {
    sourcePath: sourceUri.fsPath,
    outputTemplate,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
  };
}
