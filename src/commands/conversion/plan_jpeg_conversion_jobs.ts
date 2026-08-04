import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import { isEditableDrawioImagePath } from '../../application/policy/source_format.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import type { ConvertToJpegJob } from '../../operations/conversion/convert_to_jpeg.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { planRasterSourceConversionJobs } from './plan_raster_source_conversion_jobs.js';

import { assertFileScheme } from '../shared/command_utils.js';
import { userMessage } from '../shared/user_messages.js';

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.jpeg';

export async function planJpegConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  defaultConfiguration: Configuration,
  maxInputPixels: number,
  runtime?: ConversionExecutionContext,
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
    return createPdfJobs(sourcePath, workspace, configuration, runtime);
  }

  const outputTemplate = outputTemplateForSource(sourcePath, configuration, defaultConfiguration);
  return planRasterSourceConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.jpg', '.jpeg'],
    maxInputPixels,
  });
}

async function createPdfJobs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  configuration: Configuration,
  runtime?: ConversionExecutionContext,
): Promise<ConvertToJpegJob[]> {
  runtime?.signal?.throwIfAborted();
  runtime?.reportMessage?.(userMessage('message.progress.analyzingPdf'));
  const document = await PDFDocument.load(await readFile(sourcePath));
  const pageCount = document.getPageCount();

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }

  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToJpeg', defaultPdfOutputPath);
  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  const jobs: ConvertToJpegJob[] = [];

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
        { allowedExtensions: ['.jpg', '.jpeg'] },
      ),
      page,
    });
  }

  return jobs;
}

function outputTemplateForSource(
  sourcePath: string,
  configuration: Configuration,
  defaultConfiguration: Configuration,
): string {
  return resolveConversionTemplate({
    target: 'jpeg',
    sourcePath,
    configuration,
    defaultConfiguration,
    pluralFallback: defaultDrawioOutputPath,
  });
}
