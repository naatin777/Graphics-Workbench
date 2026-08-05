import path from 'node:path';

import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import { isEditableDrawioImagePath, isNativeDrawioPath } from '../../application/policy/source_format.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import type { ConvertToPngJob } from '../../operations/conversion/convert_to_png.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { planRasterSourceConversionJobs } from './plan_raster_source_conversion_jobs.js';
import { planPdfPageConversionJobs } from './plan_pdf_page_conversion_jobs.js';

import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertFileScheme } from '../shared/command_utils.js';

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.png';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.png';

export async function planPngConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  maxInputPixels: number,
  runtime?: ConversionExecutionContext,
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
    return createPdfJobs(sourcePath, workspace, configuration, runtime);
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

  const outputTemplate = outputTemplateForSource(sourcePath, configuration);
  return planRasterSourceConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.png'],
    maxInputPixels,
  });
}

async function createPdfJobs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  configuration: Configuration,
  runtime?: ConversionExecutionContext,
): Promise<ConvertToPngJob[]> {
  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToPng', defaultPdfOutputPath);
  return planPdfPageConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.png'],
    runtime,
    createJob: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
}

function outputTemplateForSource(sourcePath: string, configuration: Configuration): string {
  return resolveConversionTemplate({
    target: 'png',
    sourcePath,
    configuration,
    pluralFallback: defaultDrawioOutputPath,
  });
}
