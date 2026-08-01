import path from 'node:path';

import * as vscode from 'vscode';

import { getDefaultConfiguration, type Configuration } from '../../generated-extension-meta.js';

import {
  isEditableDrawioImagePath,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../application/policy/source_format.js';
import {
  readGhostscriptExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import {
  readMermaidPuppeteerOptions,
  readPuppeteerExecutablePath,
} from '../../config/rendering/mermaid_puppeteer_options.js';
import { resolveOutputPathTemplate } from '../../config/output/output_path_settings.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import {
  convertToPdfFiles,
  validateSvgToPdfOptions,
  type ConvertToPdfJob,
} from '../../operations/conversion/convert_to_pdf.js';
import type { SvgToPdfBackend } from '../../operations/conversion/tools/index.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { getCommandConfiguration, isAbortError, readDrawioOptions, selectedUris } from '../shared/command_utils.js';

export { CONVERT_PNG_TO_PDF_COMMAND } from '../command_ids.js';
export { CONVERT_TO_PDF_COMMAND } from '../command_ids.js';

const pngExtensions = ['.png'] as const;
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
  '.eps',
  '.drawio.png',
  '.dio.png',
  '.drawio.svg',
  '.dio.svg',
] as const;

export async function convertPngToPdfInternalCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  await convertSelectedSourcesToPdf(
    uri,
    uris,
    {
      supportedExtensions: pngExtensions,
      titleKey: 'message.progress.convertPngToPdf.title',
      successKey: 'message.convertPngToPdf.success',
      failedKey: 'message.convertPngToPdf.failed',
      cancelledKey: 'message.convertPngToPdf.cancelled',
      operationName: 'convert-png-to-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
    },
    dependencies,
  );
}

export async function convertToPdfCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  await convertSelectedSourcesToPdf(
    uri,
    uris,
    {
      supportedExtensions: pdfImageExtensions,
      titleKey: 'message.progress.convertToPdf.title',
      successKey: 'message.convertToPdf.success',
      failedKey: 'message.convertToPdf.failed',
      cancelledKey: 'message.convertToPdf.cancelled',
      operationName: 'convert-to-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
    },
    dependencies,
  );
}

async function convertSelectedSourcesToPdf(
  uri: vscode.Uri | undefined,
  uris: vscode.Uri[] | undefined,
  messages: {
    supportedExtensions: readonly string[];
    titleKey: 'message.progress.convertPngToPdf.title' | 'message.progress.convertToPdf.title';
    successKey: 'message.convertPngToPdf.success' | 'message.convertToPdf.success';
    failedKey: 'message.convertPngToPdf.failed' | 'message.convertToPdf.failed';
    cancelledKey: 'message.convertPngToPdf.cancelled' | 'message.convertToPdf.cancelled';
    operationName: string;
    outputChannel?: LineOutputChannel;
  },
  dependencies?: CommandDependencies,
): Promise<void> {
  try {
    const sourceUris = selectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }

    const configuration = getCommandConfiguration(dependencies);
    const defaultConfiguration = getDefaultConfiguration();
    const maxInputPixels = getMaxInputPixels(configuration);
    const outputTemplate = resolveOutputPathTemplate(
      configuration.outputPath.convertPngToPdf(),
      defaultConfiguration.outputPath.convertPngToPdf(),
    );
    const svgToPdfTools = readSvgToPdfOptions(configuration);
    validateSvgToPdfOptions(svgToPdfTools);
    const mermaidTools = readMermaidPuppeteerOptions(configuration);
    const drawioTools = readDrawioOptions(configuration);
    const ghostscriptPath = readGhostscriptExecutablePath(configuration);
    const plannedJobs = await Promise.all(
      sourceUris.map(async (sourceUri) =>
        planToPdfConversionJobs(
          sourceUri,
          outputTemplateForSource(sourceUri, outputTemplate, configuration, defaultConfiguration),
          logicalSourcePathForOutputTemplate(sourceUri.fsPath),
          messages.supportedExtensions,
        ),
      ),
    );
    const jobs = plannedJobs.flat();
    await runConversionLifecycle({
      operationName: messages.operationName,
      ...(messages.outputChannel !== undefined && { outputChannel: messages.outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage(messages.titleKey, jobs.length),
        prepareMessage: userMessage('message.progress.prepareConversion', 'PDF'),
        successMessage: (count) => userMessage(messages.successKey, count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage(messages.cancelledKey),
        failedMessage: (reason) => userMessage(messages.failedKey, reason),
      },
      run: async (runtime) =>
        convertToPdfFiles({
          jobs,
          maxInputPixels,
          supportedExtensions: messages.supportedExtensions,
          tools: {
            svgToPdfTools,
            mermaidTools,
            drawioTools,
            ghostscriptPath,
          },
          operationName: messages.operationName,
          runtime,
        }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage(messages.cancelledKey));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage(messages.failedKey, message));
  }
}

export function outputTemplateForSource(
  sourceUri: vscode.Uri,
  pngOutputTemplate: string,
  configuration = getCommandConfiguration(),
  defaultConfiguration = getDefaultConfiguration(),
): string {
  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if (isEditableDrawioImagePath(sourcePath)) {
    return configuration.outputPath.convertDrawioToPdfDirectly();
  }

  switch (extension) {
    case '.png': {
      return pngOutputTemplate;
    }
    case '.jpg':
    case '.jpeg': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertJpegToPdf(),
        defaultConfiguration.outputPath.convertJpegToPdf(),
      );
    }
    case '.webp': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertWebpToPdf(),
        defaultConfiguration.outputPath.convertWebpToPdf(),
      );
    }
    case '.avif': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertAvifToPdf(),
        defaultConfiguration.outputPath.convertAvifToPdf(),
      );
    }
    case '.svg': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertSvgToPdf(),
        defaultConfiguration.outputPath.convertSvgToPdf(),
      );
    }
    case '.mmd':
    case '.mermaid': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertMermaidToPdf(),
        defaultConfiguration.outputPath.convertMermaidToPdf(),
      );
    }
    case '.gif': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertGifToPdf(),
        defaultConfiguration.outputPath.convertGifToPdf(),
      );
    }
    case '.tif':
    case '.tiff': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertTiffToPdf(),
        defaultConfiguration.outputPath.convertTiffToPdf(),
      );
    }
    case '.eps': {
      return resolveOutputPathTemplate(
        configuration.outputPath.convertEpsToPdf(),
        defaultConfiguration.outputPath.convertEpsToPdf(),
      );
    }
    default: {
      throw new Error(`Unsupported PDF input format: ${sourcePath}`);
    }
  }
}

export function readSvgToPdfOptions(configuration: Configuration): SvgToPdfBackend {
  const executablePath = readPuppeteerExecutablePath(configuration);

  return {
    engine: configuration.convertToPdf.svg.engine(),
    rsvgConvertPath: readRsvgConvertExecutablePath(configuration),
    puppeteerBrowser: configuration.puppeteer.browser(),
    puppeteerBrowserChannel: 'chrome',
    ...(executablePath ? { puppeteerExecutablePath: executablePath } : {}),
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
        outputPath: resolveOutputPath(
          outputTemplate,
          {
            sourcePath: templateSourcePath,
            workspacePath: workspace.uri.fsPath,
            workspaceName: workspace.name,
          },
          { allowedExtensions: ['.pdf'] },
        ),
        workspacePath: workspace.uri.fsPath,
      },
    ];
  }

  return [
    {
      sourcePath: sourceUri.fsPath,
      workspacePath: workspace.uri.fsPath,
      outputPath: resolveOutputPath(outputTemplate, {
        sourcePath: templateSourcePath,
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
      }),
    },
  ];
}
