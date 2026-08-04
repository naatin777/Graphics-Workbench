import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import type { Configuration } from '../../generated-extension-meta.js';

import {
  isEditableDrawioImagePath,
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
import { resolveConversionTemplate } from './conversion_routing.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { executeTiffConversion, type ConvertToTiffJob } from '../../operations/conversion/convert_to_tiff.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { createRasterFrameJobs } from './create_raster_frame_jobs.js';
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

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.tiff';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.tiff';

export async function convertToTiffCommand(
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
    await runConversionLifecycle({
      operationName: 'convert-to-tiff',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('TIFF', sourceUris.length),
      run: async (runtime) => {
        const plannedJobs = await Promise.all(
          sourceUris.map(async (sourceUri) =>
            planTiffConversionJobs(sourceUri, configuration, maxInputPixels, runtime),
          ),
        );
        const jobs = plannedJobs.flat();
        return executeTiffConversion({
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
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'TIFF'));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'TIFF', message));
  }
}

async function planTiffConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  maxInputPixels: number,
  runtime?: ConversionExecutionContext,
): Promise<ConvertToTiffJob[]> {
  assertFileScheme(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }
  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();
  if ((extension === '.tif' || extension === '.tiff') && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for TIFF conversion: ${sourcePath}`);
  }
  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return createPdfJobs(sourcePath, workspace, configuration, runtime);
  }
  const outputTemplate = outputTemplateForSource(sourcePath, configuration);
  if (isRasterImagePath(sourcePath)) {
    return createRasterFrameJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate,
      allowedExtensions: ['.tif', '.tiff'],
      maxInputPixels,
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
        { allowedExtensions: ['.tif', '.tiff'] },
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
): Promise<ConvertToTiffJob[]> {
  runtime?.signal?.throwIfAborted();
  runtime?.reportMessage?.(userMessage('message.progress.analyzingPdf'));
  const document = await PDFDocument.load(await readFile(sourcePath));
  const pageCount = document.getPageCount();
  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }
  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToTiff', defaultPdfOutputPath);
  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  const jobs: ConvertToTiffJob[] = [];

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
        { allowedExtensions: ['.tif', '.tiff'] },
      ),
      page,
    });
  }

  return jobs;
}

function outputTemplateForSource(sourcePath: string, configuration: Configuration): string {
  return resolveConversionTemplate({
    target: 'tiff',
    sourcePath,
    configuration,
    pluralFallback: defaultDrawioOutputPath,
  });
}
