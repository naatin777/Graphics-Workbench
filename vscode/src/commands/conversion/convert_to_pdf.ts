import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import {
  isSupportedPdfConversionSource,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '@graphics-workbench/core/shared/source_format.js';
import { resolveChromeExecutablePath } from '../../config/rendering/chrome_cli_options.js';
import { resolvePdfOutputPath } from '@graphics-workbench/core/config/output/resolve_output_path.js';
import {
  convertToPdfFiles,
  executeChrome,
  executeRsvgConvert,
  validateSvgToPdfOptions,
  type PdfInput,
} from '../../operations/conversion/convert_to_pdf.js';
import type { SvgToPdfBackend } from '../../operations/conversion/tools/svg_to_pdf_tools.js';
import type { LineOutputChannel } from '@graphics-workbench/core/operations/external_tools/external_tool_ascii_scratch.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { createDrawioBackend } from '../../config/rendering/drawio_cli_options.js';

export async function convertToPdfCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  await convertSelectedSourcesToPdf(sourceUris, dependencies, outputChannel);
}

async function convertSelectedSourcesToPdf(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  outputChannel: LineOutputChannel,
): Promise<void> {
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
      const maxInputPixels = configuration.raster.maxInputPixels();
      const svgToPdfTools = createSvgToPdfBackend(configuration);
      validateSvgToPdfOptions(svgToPdfTools);
      const drawioTools = createDrawioBackend(configuration);
      const plannedInputs: PdfInput[] = [];
      const outputTemplate = outputTemplateForSource(configuration);
      for (const sourceUri of sourceUris) {
        runtime.signal?.throwIfAborted();
        plannedInputs.push(
          ...(await planToPdfInputs(sourceUri, outputTemplate, logicalSourcePathForOutputTemplate(sourceUri.fsPath))),
        );
      }
      runtime.signal?.throwIfAborted();
      return convertToPdfFiles({
        inputs: plannedInputs,
        maxInputPixels,
        tools: { svgToPdfTools, drawioTools },
        runtime,
      });
    },
  });
}

export function outputTemplateForSource(configuration: Configuration): string {
  return configuration.outputPath.single.pdf();
}

export function createSvgToPdfBackend(configuration: Configuration): SvgToPdfBackend {
  return {
    engine: configuration.convertToPdf.svg.engine(),
    rsvgConvertPath: configuration.execPath.rsvgConvert(),
    chromePath: resolveChromeExecutablePath(configuration),
    runRsvgConvert: executeRsvgConvert,
    runChrome: executeChrome,
  };
}

async function planToPdfInputs(
  sourceUri: vscode.Uri,
  outputTemplate: string,
  templateSourcePath: string,
): Promise<PdfInput[]> {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local image files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The image must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  if (!isSupportedPdfConversionSource(sourceUri.fsPath)) {
    throw new Error(`Unsupported input format: ${sourceUri.fsPath}`);
  }

  if (isRasterImagePath(sourceUri.fsPath)) {
    return [
      {
        sourcePath: sourceUri.fsPath,
        outputPath: resolvePdfOutputPath(outputTemplate, {
          sourcePath: templateSourcePath,
          workspacePath: workspace.uri.fsPath,
          workspaceName: workspace.name,
        }),
        workspacePath: workspace.uri.fsPath,
      },
    ];
  }

  return [
    {
      sourcePath: sourceUri.fsPath,
      workspacePath: workspace.uri.fsPath,
      outputPath: resolvePdfOutputPath(outputTemplate, {
        sourcePath: templateSourcePath,
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
      }),
    },
  ];
}
