import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import { isEditableDrawioImagePath } from '../../application/policy/source_format.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import type { ConvertToTiffJob } from '../../operations/conversion/convert_to_tiff.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { planRasterSourceConversionJobs } from './plan_raster_source_conversion_jobs.js';

import { assertFileScheme } from '../shared/command_utils.js';
import { userMessage } from '../shared/user_messages.js';

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.tiff';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.tiff';

export async function planTiffConversionJobs(
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

  return planRasterSourceConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate: outputTemplateForSource(sourcePath, configuration),
    allowedExtensions: ['.tif', '.tiff'],
    maxInputPixels,
  });
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
