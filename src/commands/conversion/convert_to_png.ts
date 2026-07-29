import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import type { Configuration } from '../../generated-extension-meta.js';

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
import { executePngConversion, type ConvertToPngJob } from '../../operations/conversion/convert_to_png.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { createRasterFrameJobs } from './create_raster_frame_jobs.js';

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

export const CONVERT_TO_PNG_COMMAND = 'graphics-workbench.convertToPng';

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.png';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.png';

export async function convertToPngCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = selectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }

    const configuration = getCommandConfiguration(dependencies);
    const maxInputPixels = getMaxInputPixels(configuration);
    const plannedJobs = await Promise.all(
      sourceUris.map(async (sourceUri) => planPngConversionJobs(sourceUri, configuration, maxInputPixels)),
    );
    const jobs = plannedJobs.flat();
    const mermaidTools = readMermaidPuppeteerOptions(configuration);
    const drawioTools = readDrawioOptions(configuration);
    const pdftocairoTools = { pdftocairoPath: readPdftocairoExecutablePath(configuration), platform: process.platform };
    const ghostscriptTools = {
      ghostscriptPath: readGhostscriptExecutablePath(configuration),
      platform: process.platform,
    };
    await runConversionLifecycle({
      operationName: 'convert-to-png',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('PNG', sourceUris.length),
      run: async (runtime) =>
        executePngConversion({
          jobs,
          maxInputPixels,
          pdftocairoTools,
          ghostscriptTools,
          mermaidTools,
          drawioTools,
          runtime,
        }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'PNG'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'PNG', message));
  }
}

async function planPngConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  maxInputPixels: number,
): Promise<ConvertToPngJob[]> {
  assertFileScheme(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if (extension === '.png' && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for PNG conversion: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return planPdfToPngJobs(sourcePath, workspace, configuration);
  }

  if (isNativeDrawioPath(sourcePath)) {
    const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertDrawioToPng', defaultDrawioOutputPath);
    const outputPath = resolveOutputPath(
      outputTemplate,
      {
        sourcePath,
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
      },
      { allowedExtensions: ['.png'] },
    );
    return [{ sourcePath, workspacePath: workspace.uri.fsPath, outputPath }];
  }

  const page = isEditableDrawioImagePath(sourcePath) ? '1' : undefined;
  const outputTemplate = outputTemplateForSource(sourcePath, configuration);
  if (isRasterImagePath(sourcePath)) {
    return createRasterFrameJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate,
      allowedExtensions: ['.png'],
      maxInputPixels,
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
    { allowedExtensions: ['.png'] },
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

async function planPdfToPngJobs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  configuration: Configuration,
): Promise<ConvertToPngJob[]> {
  const document = await PDFDocument.load(await readFile(sourcePath));
  const pageCount = document.getPageCount();

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }

  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToPng', defaultPdfOutputPath);
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
        { allowedExtensions: ['.png'] },
      ),
      page,
    };
  });
}

function outputTemplateForSource(sourcePath: string, configuration: Configuration): string {
  const extension = path.extname(sourcePath).toLowerCase();

  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return resolveOutputPathsTemplate(configuration, 'convertDrawioToPng', defaultDrawioOutputPath);
  }

  switch (extension) {
    case '.jpg':
    case '.jpeg': {
      return configuration.outputPath.convertJpegToPng();
    }
    case '.webp': {
      return configuration.outputPath.convertWebpToPng();
    }
    case '.avif': {
      return configuration.outputPath.convertAvifToPng();
    }
    case '.gif': {
      return resolveOutputPathOrPathsTemplate(
        configuration,
        'convertGifToPng',
        configuration.outputPath.convertGifToPng,
      );
    }
    case '.tif':
    case '.tiff': {
      return resolveOutputPathOrPathsTemplate(
        configuration,
        'convertTiffToPng',
        configuration.outputPath.convertTiffToPng,
      );
    }
    case '.svg': {
      return configuration.outputPath.convertSvgToPng();
    }
    case '.mmd':
    case '.mermaid': {
      return configuration.outputPath.convertMermaidToPng();
    }
    default: {
      throw new Error(`Unsupported PNG input format: ${sourcePath}`);
    }
  }
}
