import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { getDefaultConfiguration, type Configuration, type OutputPaths } from '../../generated-extension-meta.js';

import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../application/policy/source_format.js';
import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { resolveOutputPathOrPathsTemplate } from '../../config/output/read_output_path_or_paths_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import {
  executeWebpConversion,
  type ConvertToWebpJob,
  type WebpOutputOptions,
} from '../../operations/conversion/convert_to_webp.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { createRasterFrameJobs, readRasterAnimationMetadata } from './create_raster_frame_jobs.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import {
  assertFileScheme,
  getCommandConfiguration,
  isAbortError,
  readDrawioOptions,
  selectedUris,
} from '../shared/command_utils.js';

export const CONVERT_TO_WEBP_COMMAND = 'graphics-workbench.convertToWebp';
export const CONVERT_TO_WEBP_PRESERVE_COMMAND = 'graphics-workbench.convertToWebpPreserveAnimation';
export const CONVERT_TO_WEBP_SEPARATELY_COMMAND = 'graphics-workbench.convertToWebpSeparately';

const defaultSplitOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.webp';
const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.webp';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.webp';

export interface ConvertToWebpCommandOptions {
  outputMode?: 'auto' | 'preserve' | 'split';
}

export async function convertToWebpCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
  options?: ConvertToWebpCommandOptions,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = selectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }

    const configuration = getCommandConfiguration(dependencies);
    const defaultConfiguration = getDefaultConfiguration();
    const maxInputPixels = getMaxInputPixels(configuration);
    const plannedJobs = await Promise.all(
      sourceUris.map(async (sourceUri) =>
        planWebpConversionJobs(sourceUri, configuration, defaultConfiguration, maxInputPixels, options?.outputMode),
      ),
    );
    const jobs = plannedJobs.flat();
    const mermaidTools = readMermaidPuppeteerOptions(configuration);
    const drawioTools = readDrawioOptions(configuration);
    const webp = readWebpOutputOptions(configuration);
    const pdftocairoTools = { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform };
    const ghostscriptTools = {
      ghostscriptPath: readGhostscriptExecutablePath(configuration),
      platform: process.platform,
    };
    await runConversionLifecycle({
      operationName: 'convert-to-webp',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('WebP', sourceUris.length),
      run: async (runtime) =>
        executeWebpConversion({
          jobs,
          maxInputPixels,
          pdftocairoTools,
          ghostscriptTools,
          mermaidTools,
          drawioTools,
          webp,
          runtime,
        }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'WebP'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'WebP', message));
  }
}

async function planWebpConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  defaultConfiguration: Configuration,
  maxInputPixels: number,
  outputMode?: 'auto' | 'preserve' | 'split',
): Promise<ConvertToWebpJob[]> {
  assertFileScheme(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if (extension === '.webp' && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for WebP conversion: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return createPdfJobs(sourcePath, workspace, configuration);
  }

  const page = isEditableDrawioImagePath(sourcePath) ? '1' : undefined;
  const outputTemplate = outputTemplateForSource(sourcePath, configuration, defaultConfiguration, outputMode);
  if (isRasterImagePath(sourcePath)) {
    const animation = extension === '.gif' ? await readRasterAnimationMetadata(sourcePath, maxInputPixels) : undefined;
    if (animation !== undefined && outputMode !== 'split') {
      return [
        {
          sourcePath,
          workspacePath: workspace.uri.fsPath,
          outputPath: resolveOutputPath(
            outputTemplate,
            {
              sourcePath: logicalSourcePathForOutputTemplate(sourcePath),
              workspacePath: workspace.uri.fsPath,
              workspaceName: workspace.name,
            },
            { allowedExtensions: ['.webp'] },
          ),
          animation,
        },
      ];
    }

    return createRasterFrameJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate,
      allowedExtensions: ['.webp'],
      maxInputPixels,
      frameMode: outputMode === 'split' ? 'all' : 'first',
      createJob: (job) => job,
    });
  }
  const outputPath = resolveOutputPath(
    outputTemplate,
    {
      sourcePath: logicalSourcePathForOutputTemplate(sourcePath),
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      ...(page !== undefined && { page }),
    },
    { allowedExtensions: ['.webp'] },
  );

  return [
    {
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      outputPath,
      ...(page !== undefined && { page: Number(page) }),
    },
  ];
}

async function createPdfJobs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  configuration: Configuration,
): Promise<ConvertToWebpJob[]> {
  const document = await PDFDocument.load(await readFile(sourcePath));
  const pageCount = document.getPageCount();

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }

  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToWebp', defaultPdfOutputPath);
  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  return Array.from({ length: pageCount }, (_value, index) => {
    const page = index + 1;
    return {
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      outputPath: resolveOutputPath(
        outputTemplate,
        {
          sourcePath,
          workspacePath: workspace.uri.fsPath,
          workspaceName: workspace.name,
          page: formatOutputPage(page, pageCount),
        },
        { allowedExtensions: ['.webp'] },
      ),
      page,
    };
  });
}

function outputTemplateForSource(
  sourcePath: string,
  configuration: Configuration,
  defaultConfiguration: Configuration,
  outputMode?: 'auto' | 'preserve' | 'split',
): string {
  const splitDefault = outputMode === 'split' ? defaultSplitOutputPath : undefined;
  const extension = path.extname(sourcePath).toLowerCase();
  const readPairTemplate = (key: keyof OutputPaths, setting: () => string, defaultSetting: () => string): string =>
    resolveOutputPathOrPathsTemplate(configuration, key, setting, splitDefault, defaultSetting);

  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return resolveOutputPathsTemplate(configuration, 'convertDrawioToWebp', defaultDrawioOutputPath);
  }

  switch (extension) {
    case '.png': {
      return readPairTemplate(
        'convertPngToWebp',
        configuration.outputPath.convertPngToWebp,
        defaultConfiguration.outputPath.convertPngToWebp,
      );
    }
    case '.jpg':
    case '.jpeg': {
      return readPairTemplate(
        'convertJpegToWebp',
        configuration.outputPath.convertJpegToWebp,
        defaultConfiguration.outputPath.convertJpegToWebp,
      );
    }
    case '.avif': {
      return readPairTemplate(
        'convertAvifToWebp',
        configuration.outputPath.convertAvifToWebp,
        defaultConfiguration.outputPath.convertAvifToWebp,
      );
    }
    case '.svg': {
      return readPairTemplate(
        'convertSvgToWebp',
        configuration.outputPath.convertSvgToWebp,
        defaultConfiguration.outputPath.convertSvgToWebp,
      );
    }
    case '.mmd':
    case '.mermaid': {
      return readPairTemplate(
        'convertMermaidToWebp',
        configuration.outputPath.convertMermaidToWebp,
        defaultConfiguration.outputPath.convertMermaidToWebp,
      );
    }
    default: {
      throw new Error(`Unsupported WebP input format: ${sourcePath}`);
    }
  }
}

function readWebpOutputOptions(configuration: Configuration): WebpOutputOptions {
  const effort = configuration.convertToWebp.effort();

  if (!Number.isInteger(effort) || effort < 0 || effort > 6) {
    throw new Error(`convertToWebp.effort must be an integer between 0 and 6: ${effort}`);
  }

  return { effort };
}
