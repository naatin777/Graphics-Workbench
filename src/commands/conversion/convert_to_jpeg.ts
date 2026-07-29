import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { configs, getExtensionConfiguration } from '../../generated-extension-config.js';

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
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { executeJpegConversion, type ConvertToJpegJob } from '../../operations/conversion/convert_to_jpeg.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { createRasterFrameJobs } from './create_raster_frame_jobs.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { assertFileScheme, isAbortError, readDrawioOptions, selectedUris } from '../shared/command_utils.js';

export const CONVERT_TO_JPEG_COMMAND = 'graphics-workbench.convertToJpeg';

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.jpeg';

export async function convertToJpegCommand(
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

    const configuration = getExtensionConfiguration();
    const maxInputPixels = getMaxInputPixels(configuration);
    const plannedJobs = await Promise.all(
      sourceUris.map(async (sourceUri) => planJpegConversionJobs(sourceUri, configuration, maxInputPixels)),
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
      operationName: 'convert-to-jpeg',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('JPEG', sourceUris.length),
      run: async (runtime) =>
        executeJpegConversion({
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
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'JPEG'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'JPEG', message));
  }
}

async function planJpegConversionJobs(
  sourceUri: vscode.Uri,
  configuration: vscode.WorkspaceConfiguration,
  maxInputPixels: number,
): Promise<ConvertToJpegJob[]> {
  assertFileScheme(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if ((extension === '.jpg' || extension === '.jpeg') && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for JPEG conversion: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return createPdfJobs(sourcePath, workspace, configuration);
  }

  const page = isEditableDrawioImagePath(sourcePath) ? '1' : undefined;
  const outputTemplate = outputTemplateForSource(sourcePath, configuration);
  if (isRasterImagePath(sourcePath)) {
    return createRasterFrameJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate,
      allowedExtensions: ['.jpg', '.jpeg'],
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
    { allowedExtensions: ['.jpg', '.jpeg'] },
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
  configuration: vscode.WorkspaceConfiguration,
): Promise<ConvertToJpegJob[]> {
  const document = await PDFDocument.load(await readFile(sourcePath));
  const pageCount = document.getPageCount();

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }

  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToJpeg', defaultPdfOutputPath);
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
        { allowedExtensions: ['.jpg', '.jpeg'] },
      ),
      page,
    };
  });
}

function outputTemplateForSource(sourcePath: string, configuration: vscode.WorkspaceConfiguration): string {
  const extension = path.extname(sourcePath).toLowerCase();

  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return resolveOutputPathsTemplate(configuration, 'convertDrawioToJpeg', defaultDrawioOutputPath);
  }

  switch (extension) {
    case '.png': {
      return configs.outputPath.convertPngToJpeg();
    }
    case '.webp': {
      return configs.outputPath.convertWebpToJpeg();
    }
    case '.avif': {
      return configs.outputPath.convertAvifToJpeg();
    }
    case '.svg': {
      return configs.outputPath.convertSvgToJpeg();
    }
    case '.mmd':
    case '.mermaid': {
      return configs.outputPath.convertMermaidToJpeg();
    }
    default: {
      throw new Error(`Unsupported JPEG input format: ${sourcePath}`);
    }
  }
}
