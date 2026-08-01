import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import type { Configuration, OutputPaths } from '../../generated-extension-meta.js';

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
import { executeGifConversion, type ConvertToGifJob } from '../../operations/conversion/convert_to_gif.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { createRasterFrameJobs, readRasterAnimationMetadata } from './create_raster_frame_jobs.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import {
  assertFileScheme,
  getCommandConfiguration,
  isAbortError,
  readDrawioOptions,
  selectedUris,
} from '../shared/command_utils.js';

const defaultSplitOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.gif';
const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.gif';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.gif';

export interface ConvertToGifCommandOptions {
  outputMode?: 'auto' | 'preserve' | 'split';
}

export async function convertToGifCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
  options?: ConvertToGifCommandOptions,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = selectedUris(uri, uris);
    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }
    const configuration = getCommandConfiguration(dependencies);
    const maxInputPixels = getMaxInputPixels(configuration);
    await runConversionLifecycle({
      operationName: 'convert-to-gif',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('GIF', sourceUris.length),
      run: async (runtime) => {
        const plannedJobs = await Promise.all(
          sourceUris.map(async (sourceUri) =>
            planGifConversionJobs(sourceUri, configuration, maxInputPixels, options?.outputMode, runtime),
          ),
        );
        const jobs = plannedJobs.flat();
        return executeGifConversion({
          jobs,
          maxInputPixels,
          pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform },
          ghostscriptTools: {
            ghostscriptPath: readGhostscriptExecutablePath(configuration),
            platform: process.platform,
          },
          mermaidTools: readMermaidPuppeteerOptions(configuration),
          drawioTools: readDrawioOptions(configuration),
          runtime,
        });
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'GIF'));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'GIF', message));
  }
}

async function planGifConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  maxInputPixels: number,
  outputMode?: 'auto' | 'preserve' | 'split',
  runtime?: ConversionExecutionContext,
): Promise<ConvertToGifJob[]> {
  assertFileScheme(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }
  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.gif' && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for GIF conversion: ${sourcePath}`);
  }
  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return createPdfJobs(sourcePath, workspace, configuration, runtime);
  }
  const outputTemplate = outputTemplateForSource(sourcePath, configuration, outputMode);
  if (isRasterImagePath(sourcePath)) {
    const animation = extension === '.webp' ? await readRasterAnimationMetadata(sourcePath, maxInputPixels) : undefined;
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
            { allowedExtensions: ['.gif'] },
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
      allowedExtensions: ['.gif'],
      maxInputPixels,
      frameMode: outputMode === 'split' ? 'all' : 'first',
      createJob: (job) => job,
    });
  }
  const page = isEditableDrawioImagePath(sourcePath) ? '1' : undefined;
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
          ...(page !== undefined && { page }),
        },
        { allowedExtensions: ['.gif'] },
      ),
      ...(page !== undefined && { page: Number(page) }),
    },
  ];
}

async function createPdfJobs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  configuration: Configuration,
  runtime?: ConversionExecutionContext,
): Promise<ConvertToGifJob[]> {
  runtime?.signal?.throwIfAborted();
  runtime?.reportMessage?.(userMessage('message.progress.analyzingPdf'));
  const document = await PDFDocument.load(await readFile(sourcePath));
  const pageCount = document.getPageCount();
  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }
  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToGif', defaultPdfOutputPath);
  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  const jobs: ConvertToGifJob[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    runtime?.signal?.throwIfAborted();
    const page = index + 1;
    jobs.push({
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
        { allowedExtensions: ['.gif'] },
      ),
      page,
    });
  }

  return jobs;
}

function outputTemplateForSource(
  sourcePath: string,
  configuration: Configuration,
  outputMode?: 'auto' | 'preserve' | 'split',
): string {
  const splitDefault = outputMode === 'split' ? defaultSplitOutputPath : undefined;
  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return resolveOutputPathsTemplate(configuration, 'convertDrawioToGif', defaultDrawioOutputPath);
  }

  return outputTemplateForExtension(path.extname(sourcePath).toLowerCase(), configuration, splitDefault);
}

function outputTemplateForExtension(
  extension: string,
  configuration: Configuration,
  splitDefault: string | undefined,
): string {
  const readPairTemplate = (key: keyof OutputPaths, setting: () => string): string =>
    resolveOutputPathOrPathsTemplate(configuration, key, setting, splitDefault);

  switch (extension) {
    case '.png': {
      return readPairTemplate('convertPngToGif', configuration.outputPath.convertPngToGif);
    }
    case '.jpg':
    case '.jpeg': {
      return readPairTemplate('convertJpegToGif', configuration.outputPath.convertJpegToGif);
    }
    case '.webp': {
      return readPairTemplate('convertWebpToGif', configuration.outputPath.convertWebpToGif);
    }
    case '.avif': {
      return readPairTemplate('convertAvifToGif', configuration.outputPath.convertAvifToGif);
    }
    case '.tif':
    case '.tiff': {
      return readPairTemplate('convertTiffToGif', configuration.outputPath.convertTiffToGif);
    }
    case '.svg': {
      return readPairTemplate('convertSvgToGif', configuration.outputPath.convertSvgToGif);
    }
    case '.mmd':
    case '.mermaid': {
      return readPairTemplate('convertMermaidToGif', configuration.outputPath.convertMermaidToGif);
    }
    default: {
      throw new Error(`Unsupported GIF input extension: ${extension}`);
    }
  }
}
