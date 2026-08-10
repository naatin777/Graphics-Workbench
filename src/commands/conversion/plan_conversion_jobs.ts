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
import { resolveRasterOutputTemplate, type OutputCardinality } from './conversion_routing.js';
import { planRasterFrameJobs } from './plan_raster_frame_jobs.js';

import { assertLocalFileUri } from '../shared/command_input.js';
import { userMessage } from '../shared/user_messages.js';

export interface PlanRasterConversionOptions {
  configuration: Configuration;
  maxInputPixels: number;
  maxAnimationPixels?: number;
  /** 'all' splits animated frames into per-frame outputs; otherwise one output per input. */
  frameMode?: 'first' | 'all';
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

  const splitByFrames = spec.animatedInputExtension !== undefined && options.frameMode === 'all';
  const cardinality: OutputCardinality = splitByFrames ? 'split' : 'single';
  const outputTemplate = resolveRasterOutputTemplate({
    cardinality,
    target: spec.target,
    configuration: options.configuration,
  });

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
      frameMode: options.frameMode ?? 'first',
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
  const outputTemplate = resolveRasterOutputTemplate({
    cardinality: 'split',
    target: spec.target,
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
  frameMode?: 'first' | 'all';
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

  if (animation !== undefined && options.frameMode !== 'all') {
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
    frameMode: options.frameMode === 'all' ? 'all' : 'first',
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
