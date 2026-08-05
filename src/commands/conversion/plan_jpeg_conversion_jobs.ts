import path from 'node:path';

import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import { isEditableDrawioImagePath } from '../../application/policy/source_format.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import type { ConvertToJpegJob } from '../../operations/conversion/convert_to_jpeg.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { planPdfPageConversionJobs } from './plan_pdf_page_conversion_jobs.js';
import { planRasterSourceConversionJobs } from './plan_raster_source_conversion_jobs.js';

import { assertFileScheme } from '../shared/command_utils.js';

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
  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToJpeg', defaultPdfOutputPath);
  return planPdfPageConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.jpg', '.jpeg'],
    runtime,
    createJob: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
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
