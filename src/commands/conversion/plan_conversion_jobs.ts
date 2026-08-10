import path from 'node:path';
import { readFile } from 'node:fs/promises';

import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import {
  isEditableDrawioImagePath,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../shared/source_format.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertAnimationPixelLimit } from '../../config/raster.js';
import type { RasterFormatSpec, RasterInput } from '../../operations/conversion/raster_conversion.js';
import { readRasterAnimationMetadata } from '../../operations/conversion/raster_input.js';
import { countPdfPages } from '../../operations/pdf/mupdf.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { planRasterFrameJobs } from './plan_raster_frame_jobs.js';

import { assertLocalFileUri } from '../shared/command_input.js';
import { userMessage } from '../shared/user_messages.js';

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
): Promise<RasterInput[]> {
  assertLocalFileUri(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if (spec.extensions.includes(extension) && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for ${spec.label} input: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return planPdfPageRasterConversions(sourcePath, workspace, spec, options);
  }

  const outputTemplate = outputTemplateForSource(sourcePath, spec, options);

  if (spec.animatedInputExtension !== undefined) {
    const inputs = await planAnimationRasterSourceConversions({
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
    if (inputs !== undefined) {
      return inputs;
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

async function planPdfPageRasterConversions(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  spec: RasterFormatSpec,
  options: PlanRasterConversionOptions,
): Promise<RasterInput[]> {
  const outputTemplate = resolveConversionTemplate({
    target: spec.target,
    sourcePath,
    configuration: options.configuration,
  });
  return planPdfPageConversionJobs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: spec.extensions,
    ...(options.runtime !== undefined && { runtime: options.runtime }),
    toConversion: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
}

function outputTemplateForSource(
  sourcePath: string,
  spec: RasterFormatSpec,
  options: PlanRasterConversionOptions,
): string {
  return resolveConversionTemplate({
    target: spec.target,
    sourcePath,
    configuration: options.configuration,
    ...(options.outputMode === 'split' && spec.splitOutputTemplate !== undefined
      ? { templateOverride: spec.splitOutputTemplate }
      : {}),
  });
}

interface RasterSourcePlanOptions {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  maxInputPixels: number;
}

export async function planRasterSourceConversionJobs(options: RasterSourcePlanOptions): Promise<RasterInput[]> {
  const page = isEditableDrawioImagePath(options.sourcePath) ? '1' : undefined;
  if (isRasterImagePath(options.sourcePath)) {
    return planRasterFrameJobs(options);
  }

  const outputPath = resolveOutputPath(
    options.outputTemplate,
    {
      sourcePath: logicalSourcePathForOutputTemplate(options.sourcePath),
      workspacePath: options.workspacePath,
      workspaceName: options.workspaceName,
      ...(page !== undefined && { page }),
    },
    { allowedExtensions: options.allowedExtensions },
  );

  return [
    {
      sourcePath: options.sourcePath,
      workspacePath: options.workspacePath,
      outputPath,
      ...(page !== undefined && { page: Number(page) }),
    },
  ];
}

interface AnimationRasterPlanOptions extends RasterSourcePlanOptions {
  maxAnimationPixels: number;
  animatedInputExtension: string;
  outputMode?: 'auto' | 'preserve' | 'split';
}

async function planAnimationRasterSourceConversions(
  options: AnimationRasterPlanOptions,
): Promise<RasterInput[] | undefined> {
  if (!isRasterImagePath(options.sourcePath)) {
    return undefined;
  }

  const extension = path.extname(options.sourcePath).toLowerCase();
  const animation =
    extension === options.animatedInputExtension
      ? await readRasterAnimationMetadata(options.sourcePath, options.maxInputPixels)
      : undefined;

  if (animation !== undefined && options.outputMode !== 'split') {
    assertAnimationPixelLimit(
      animation.width ?? 0,
      animation.pageHeight,
      animation.pages,
      options.maxAnimationPixels,
      options.sourcePath,
    );
    return [
      {
        sourcePath: options.sourcePath,
        workspacePath: options.workspacePath,
        outputPath: resolveOutputPath(
          options.outputTemplate,
          {
            sourcePath: logicalSourcePathForOutputTemplate(options.sourcePath),
            workspacePath: options.workspacePath,
            workspaceName: options.workspaceName,
          },
          { allowedExtensions: options.allowedExtensions },
        ),
        animation,
      },
    ];
  }

  return planRasterFrameJobs({
    sourcePath: options.sourcePath,
    workspacePath: options.workspacePath,
    workspaceName: options.workspaceName,
    outputTemplate: options.outputTemplate,
    allowedExtensions: options.allowedExtensions,
    maxInputPixels: options.maxInputPixels,
    maxAnimationPixels: options.maxAnimationPixels,
    frameMode: options.outputMode === 'split' ? 'all' : 'first',
  });
}

/** PDFを読み込んでpage countを解析し、形式固有の変換単位へ変換する。 */
export async function planPdfPageConversionJobs<Conversion>(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  runtime?: ConversionExecutionContext;
  toConversion: (page: number, outputPath: string) => Conversion;
}): Promise<Conversion[]> {
  options.runtime?.signal?.throwIfAborted();
  options.runtime?.reportMessage?.(userMessage('message.progress.analyzingPdf'));
  const pageCount = await countPdfPages(await readFile(options.sourcePath));

  const inputs: Conversion[] = [];
  for (const { page, outputPath } of planPdfPageJobs(
    {
      sourcePath: options.sourcePath,
      workspacePath: options.workspacePath,
      workspaceName: options.workspaceName,
    },
    pageCount,
    options.outputTemplate,
    options.allowedExtensions,
  )) {
    options.runtime?.signal?.throwIfAborted();
    inputs.push(options.toConversion(page, outputPath));
  }
  return inputs;
}

/** The source file location used as the base for planning per-page inputs. */
export interface PdfPageSource {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
}

export interface PdfPageInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  page: number;
}

/** Pure: PDFの読み込み結果（page count）だけから、pageごとの変換単位を生成する。 */
export function planPdfPageJobs(
  source: PdfPageSource,
  pageCount: number,
  outputTemplate: string,
  allowedExtensions: readonly string[],
): PdfPageInput[] {
  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${source.sourcePath}`);
  }

  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  return Array.from({ length: pageCount }, (_value, index) => {
    const page = index + 1;
    return {
      sourcePath: source.sourcePath,
      workspacePath: source.workspacePath,
      outputPath: resolveOutputPath(
        outputTemplate,
        {
          sourcePath: source.sourcePath,
          workspacePath: source.workspacePath,
          workspaceName: source.workspaceName,
          page: formatOutputPage(page, pageCount),
        },
        { allowedExtensions },
      ),
      page,
    };
  });
}
