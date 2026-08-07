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
import type { ConvertToGifJob } from '../../operations/conversion/convert_to_gif.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

import { assertLocalFileUri } from '../shared/command_input.js';

const defaultSplitOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.gif';
const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.gif';
const defaultDrawioOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.gif';

export async function planGifConversionJobs(
  sourceUri: vscode.Uri,
  {
    configuration,
    maxInputPixels,
    maxAnimationPixels,
    outputMode,
    runtime,
  }: {
    configuration: Configuration;
    maxInputPixels: number;
    maxAnimationPixels: number;
    outputMode?: 'auto' | 'preserve' | 'split';
    runtime?: ConversionExecutionContext;
  },
): Promise<ConvertToGifJob[]> {
  assertLocalFileUri(sourceUri);
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
  const rasterJobs = await planAnimationRasterSourceJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.gif'],
    maxInputPixels,
    maxAnimationPixels,
    animatedInputExtension: '.webp',
    ...(outputMode !== undefined && { outputMode }),
  });
  if (rasterJobs !== undefined) {
    return rasterJobs;
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
  const outputTemplate = resolveOutputPathsTemplate(configuration, 'convertPdfToGif', defaultPdfOutputPath);
  return planPdfPageConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.gif'],
    runtime,
    createJob: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
}

function outputTemplateForSource(
  sourcePath: string,
  configuration: Configuration,
  outputMode?: 'auto' | 'preserve' | 'split',
): string {
  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return resolveOutputPathsTemplate(configuration, 'convertDrawioToGif', defaultDrawioOutputPath);
  }

  return resolveConversionTemplate({
    target: 'gif',
    sourcePath,
    configuration,
    ...(outputMode === 'split' ? { splitDefault: defaultSplitOutputPath } : {}),
  });
}
