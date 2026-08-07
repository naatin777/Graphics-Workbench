import path from 'node:path';

import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import { isEditableDrawioImagePath } from '../../application/policy/source_format.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import type { ConvertToTiffJob } from '../../operations/conversion/convert_to_tiff.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { planPdfPageConversionJobs } from './plan_pdf_page_conversion_jobs.js';
import { planRasterSourceConversionJobs } from './plan_raster_source_conversion_jobs.js';

import { assertLocalFileUri } from '../shared/command_input.js';

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.tiff';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.tiff';

export async function planTiffConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  maxInputPixels: number,
  runtime?: ConversionExecutionContext,
): Promise<ConvertToTiffJob[]> {
  assertLocalFileUri(sourceUri);
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
  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToTiff', defaultPdfOutputPath);
  return planPdfPageConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.tif', '.tiff'],
    runtime,
    createJob: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
}

function outputTemplateForSource(sourcePath: string, configuration: Configuration): string {
  return resolveConversionTemplate({
    target: 'tiff',
    sourcePath,
    configuration,
    pluralFallback: defaultDrawioOutputPath,
  });
}
