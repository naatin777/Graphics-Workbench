import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import {
  isEditableDrawioImagePath,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../shared/source_format.js';
import { readRsvgConvertExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { readChromeExecutablePath, readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { resolveOutputPathTemplate } from '../../config/output/output_path_settings.js';
import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import {
  convertToPdfFiles,
  executeChrome,
  executeRsvgConvert,
  validateSvgToPdfOptions,
  type ConvertToPdfJob,
} from '../../operations/conversion/convert_to_pdf.js';
import type { SvgToPdfBackend } from '../../operations/conversion/tools/svg_to_pdf_tools.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { buildDrawioCommandOptions } from '../shared/command_runtime.js';
import { isAbortError } from '../../shared/error.js';
import { resolveSelectedUris } from '../shared/command_input.js';
import { resolveConversionTemplate } from './conversion_routing.js';

const pdfImageExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.tif',
  '.tiff',
  '.svg',
  '.mmd',
  '.mermaid',
  '.drawio.png',
  '.dio.png',
  '.drawio.svg',
  '.dio.svg',
] as const;

export async function convertToPdfCommand(
  uri: vscode.Uri | undefined,
  uris: vscode.Uri[] | undefined,
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  await convertSelectedSourcesToPdf(uri, uris, dependencies, outputChannel);
}

async function convertSelectedSourcesToPdf(
  uri: vscode.Uri | undefined,
  uris: vscode.Uri[] | undefined,
  dependencies: CommandDependencies,
  outputChannel: LineOutputChannel,
): Promise<void> {
  try {
    const sourceUris = resolveSelectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }

    const configuration = dependencies.getConfiguration();
    const maxInputPixels = configuration.raster.maxInputPixels();
    const svgToPdfTools = readSvgToPdfOptions(configuration);
    validateSvgToPdfOptions(svgToPdfTools);
    const mermaidTools = readMermaidCliOptions(configuration);
    const drawioTools = buildDrawioCommandOptions(configuration);
    const plannedJobs: ConvertToPdfJob[] = [];
    for (const sourceUri of sourceUris) {
      plannedJobs.push(
        ...(await planToPdfConversionJobs(
          sourceUri,
          outputTemplateForSource(sourceUri, configuration),
          logicalSourcePathForOutputTemplate(sourceUri.fsPath),
          pdfImageExtensions,
        )),
      );
    }
    const jobs = plannedJobs;
    await runConversionLifecycle({
      operationName: 'convert-to-pdf',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.convertToPdf.title', jobs.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
        successMessage: (count) => userMessage('message.convertToPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.convertToPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.convertToPdf.failed', reason),
      },
      run: async (runtime) =>
        convertToPdfFiles({
          jobs,
          maxInputPixels,
          supportedExtensions: pdfImageExtensions,
          tools: {
            svgToPdfTools,
            mermaidTools,
            drawioTools,
          },
          operationName: 'convert-to-pdf',
          runtime,
        }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToPdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToPdf.failed', message));
  }
}

export function outputTemplateForSource(sourceUri: vscode.Uri, configuration: Configuration): string {
  const sourcePath = sourceUri.fsPath;

  if (isEditableDrawioImagePath(sourcePath)) {
    return resolveOutputPathTemplate(
      configuration.outputPath.convertDrawioToSinglePdf(),
      '${fileDirname}/${fileBasenameNoExtension}.pdf',
    );
  }

  return resolveConversionTemplate({ target: 'pdf', sourcePath, configuration });
}

export function readSvgToPdfOptions(configuration: Configuration): SvgToPdfBackend {
  return {
    engine: configuration.convertToPdf.svg.engine(),
    rsvgConvertPath: readRsvgConvertExecutablePath(configuration),
    chromePath: readChromeExecutablePath(configuration),
    runRsvgConvert: executeRsvgConvert,
    runChrome: executeChrome,
  };
}

async function planToPdfConversionJobs(
  sourceUri: vscode.Uri,
  outputTemplate: string,
  templateSourcePath: string,
  supportedExtensions: readonly string[],
): Promise<ConvertToPdfJob[]> {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local image files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The image must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const lowerSourcePath = sourceUri.fsPath.toLowerCase();
  if (!supportedExtensions.some((extension) => lowerSourcePath.endsWith(extension))) {
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
