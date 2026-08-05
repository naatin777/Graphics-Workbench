import path from 'node:path';

import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  logicalSourcePathForOutputTemplate,
} from '../../application/policy/source_format.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { planAnimationRasterSourceJobs } from './plan_animation_raster_source_jobs.js';
import { planPdfPageConversionJobs } from './plan_pdf_page_conversion_jobs.js';
import type { ConvertToWebpJob } from '../../operations/conversion/convert_to_webp.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

import { assertFileScheme } from '../shared/command_utils.js';

const defaultSplitOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.webp';
const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.webp';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.webp';

export async function planWebpConversionJobs(
  sourceUri: vscode.Uri,
  {
    configuration,
    defaultConfiguration,
    maxInputPixels,
    maxAnimationPixels,
    outputMode,
    runtime,
  }: {
    configuration: Configuration;
    defaultConfiguration: Configuration;
    maxInputPixels: number;
    maxAnimationPixels: number;
    outputMode?: 'auto' | 'preserve' | 'split';
    runtime?: ConversionExecutionContext;
  },
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
    return createPdfJobs(sourcePath, workspace, configuration, runtime);
  }

  const page = isEditableDrawioImagePath(sourcePath) ? '1' : undefined;
  const outputTemplate = outputTemplateForSource(sourcePath, configuration, defaultConfiguration, outputMode);
  const rasterJobs = await planAnimationRasterSourceJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.webp'],
    maxInputPixels,
    maxAnimationPixels,
    animatedInputExtension: '.gif',
    ...(outputMode !== undefined && { outputMode }),
  });
  if (rasterJobs !== undefined) {
    return rasterJobs;
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
  runtime?: ConversionExecutionContext,
): Promise<ConvertToWebpJob[]> {
  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToWebp', defaultPdfOutputPath);
  return planPdfPageConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.webp'],
    runtime,
    createJob: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
}

function outputTemplateForSource(
  sourcePath: string,
  configuration: Configuration,
  defaultConfiguration: Configuration,
  outputMode?: 'auto' | 'preserve' | 'split',
): string {
  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return resolveOutputPathsTemplate(configuration, 'convertDrawioToWebp', defaultDrawioOutputPath);
  }

  return resolveConversionTemplate({
    target: 'webp',
    sourcePath,
    configuration,
    defaultConfiguration,
    ...(outputMode === 'split' ? { splitDefault: defaultSplitOutputPath } : {}),
  });
}
