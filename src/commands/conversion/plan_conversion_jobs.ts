import path from 'node:path';

import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  logicalSourcePathForOutputTemplate,
} from '../../shared/source_format.js';
import { resolveOutputPathsTemplate, type OutputPathKey } from '../../config/output/output_path_settings.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import type { RasterJob } from '../../operations/conversion/raster_conversion.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import type { OutputConversionFormat } from '../lifecycle/run_output_conversion.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { planAnimationRasterSourceJobs } from './plan_animation_raster_source_jobs.js';
import { planPdfPageConversionJobs } from './plan_pdf_page_conversion_jobs.js';
import { planRasterSourceConversionJobs } from './plan_raster_source_conversion_jobs.js';

import { assertLocalFileUri } from '../shared/command_input.js';

export type RasterConversionTarget = 'png' | 'jpeg' | 'avif' | 'tiff' | 'webp' | 'gif';

export interface RasterFormatSpec {
  target: RasterConversionTarget;
  operationName: string;
  outputLabel: OutputConversionFormat;
  label: string;
  /** The format's own extensions; used for both same-format rejection and output validation. */
  extensions: readonly string[];
  settings: {
    drawio: OutputPathKey;
    pdf: OutputPathKey;
  };
  defaults: {
    pdf: string;
    drawio: string;
    split?: string;
  };
  animatedInputExtension?: string;
}

export interface PlanRasterConversionOptions {
  configuration: Configuration;
  maxInputPixels: number;
  maxAnimationPixels?: number;
  outputMode?: 'auto' | 'preserve' | 'split';
  runtime?: ConversionExecutionContext;
}

export async function planRasterConversionJobs(
  sourceUri: vscode.Uri,
  spec: RasterFormatSpec,
  options: PlanRasterConversionOptions,
): Promise<RasterJob[]> {
  assertLocalFileUri(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if (spec.extensions.includes(extension) && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for ${spec.label} conversion: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return planPdfPageRasterJobs(sourcePath, workspace, spec, options);
  }

  const outputTemplate = outputTemplateForSource(sourcePath, spec, options);

  if (spec.animatedInputExtension !== undefined) {
    const rasterJobs = await planAnimationRasterSourceJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate,
      allowedExtensions: spec.extensions,
      maxInputPixels: options.maxInputPixels,
      maxAnimationPixels: options.maxAnimationPixels ?? 0,
      animatedInputExtension: spec.animatedInputExtension,
      ...(options.outputMode !== undefined && { outputMode: options.outputMode }),
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
          { allowedExtensions: spec.extensions },
        ),
        ...(page !== undefined && { page: Number(page) }),
      },
    ];
  }

  return planRasterSourceConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: spec.extensions,
    maxInputPixels: options.maxInputPixels,
  });
}

async function planPdfPageRasterJobs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  spec: RasterFormatSpec,
  options: PlanRasterConversionOptions,
): Promise<RasterJob[]> {
  const outputTemplate = resolveOutputPathsTemplate(options.configuration, spec.settings.pdf, spec.defaults.pdf);
  return planPdfPageConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: spec.extensions,
    ...(options.runtime !== undefined && { runtime: options.runtime }),
    toJob: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
}

function outputTemplateForSource(
  sourcePath: string,
  spec: RasterFormatSpec,
  options: PlanRasterConversionOptions,
): string {
  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return resolveOutputPathsTemplate(options.configuration, spec.settings.drawio, spec.defaults.drawio);
  }

  return resolveConversionTemplate({
    target: spec.target,
    sourcePath,
    configuration: options.configuration,
    ...(options.outputMode === 'split' && spec.defaults.split !== undefined
      ? { splitDefault: spec.defaults.split }
      : {}),
  });
}
