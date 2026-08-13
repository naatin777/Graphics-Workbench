import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { assertAnimationPixelLimit } from './animation_pixel_limit.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { isRasterImagePath, logicalSourcePathForOutputTemplate } from '../../shared/source_format.js';
import { countPdfPages } from '../pdf/mupdf.js';
import { planPdfPageJobs } from './plan_pdf_page_jobs.js';
import type { RasterFormatSpec, RasterInput } from './raster_conversion.js';
import { closeRasterPipeline, openRasterInput, readRasterAnimationMetadata } from './raster_input.js';

export interface RasterFramePlanOptions {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  frameMode?: 'first' | 'all';
  maxAnimationPixels?: number;
}

export interface RasterFrameAnalysis {
  pages: number;
  width: number;
  pageHeight: number;
}

export function planRasterFrameJobsFromMetadata(
  options: RasterFramePlanOptions,
  analysis: RasterFrameAnalysis,
): RasterInput[] {
  const { pages, width, pageHeight } = analysis;

  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error(`Could not determine image frame count: ${options.sourcePath}`);
  }

  const frameMode = options.frameMode ?? 'first';
  if (frameMode === 'all' && pages > 1 && options.maxAnimationPixels !== undefined) {
    assertAnimationPixelLimit(width, pageHeight, pages, options.maxAnimationPixels, options.sourcePath);
  }
  const outputPages = frameMode === 'all' ? pages : 1;
  assertPageTemplateForSplitOutput(options.outputTemplate, outputPages);

  return Array.from({ length: outputPages }, (_value, index) => {
    const page = index + 1;
    return {
      sourcePath: options.sourcePath,
      workspacePath: options.workspacePath,
      outputPath: resolveOutputPath(
        options.outputTemplate,
        {
          sourcePath: options.sourcePath,
          workspacePath: options.workspacePath,
          workspaceName: options.workspaceName,
          page: formatOutputPage(page, outputPages),
        },
        { allowedExtensions: options.allowedExtensions },
      ),
      page,
    };
  });
}

export async function planRasterFrameJobs(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  maxInputPixels: number;
  maxAnimationPixels?: number;
  frameMode?: 'first' | 'all';
}): Promise<RasterInput[]> {
  await assertExistingPathInWorkspace(options.sourcePath, options.workspacePath);
  const image = openRasterInput(options.sourcePath, options.maxInputPixels);
  let pages: number;
  let width = 0;
  let pageHeight = 0;

  try {
    const metadata = await image.metadata();
    pages = metadata.pages ?? 1;
    ({ width } = metadata);
    pageHeight = metadata.pageHeight ?? metadata.height;
  } finally {
    await closeRasterPipeline(image);
  }

  const planOptions: RasterFramePlanOptions = {
    sourcePath: options.sourcePath,
    workspacePath: options.workspacePath,
    workspaceName: options.workspaceName,
    outputTemplate: options.outputTemplate,
    allowedExtensions: options.allowedExtensions,
  };
  if (options.frameMode !== undefined) {
    planOptions.frameMode = options.frameMode;
  }
  if (options.maxAnimationPixels !== undefined) {
    planOptions.maxAnimationPixels = options.maxAnimationPixels;
  }

  return planRasterFrameJobsFromMetadata(planOptions, { pages, width, pageHeight });
}

export interface PlanRasterSourceConversionInputsOptions {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  page?: string;
  maxInputPixels: number;
  signal?: AbortSignal;
  isEditableDrawioImagePath: (path: string) => boolean;
}

export async function planRasterSourceConversionInputs(
  options: PlanRasterSourceConversionInputsOptions,
): Promise<RasterInput[]> {
  const page = options.page ?? (options.isEditableDrawioImagePath(options.sourcePath) ? '1' : undefined);
  if (isRasterImagePath(options.sourcePath)) {
    return planRasterFrameJobs(options);
  }

  options.signal?.throwIfAborted();
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

export interface PlanRasterConversionInputsOptions {
  source: {
    sourcePath: string;
    workspacePath: string;
    workspaceName: string;
  };
  spec: RasterFormatSpec;
  outputTemplate: string;
  splitOutputTemplate: string;
  frameMode: 'first' | 'all';
  maxInputPixels: number;
  maxAnimationPixels?: number;
  isEditableDrawioImagePath: (path: string) => boolean;
  signal?: AbortSignal;
  report?: (message: string) => void;
}

export async function planRasterConversionInputs(options: PlanRasterConversionInputsOptions): Promise<RasterInput[]> {
  const { source, spec } = options;
  const { sourcePath } = source;
  const extension = path.extname(sourcePath).toLowerCase();

  if (spec.extensions.includes(extension) && !options.isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for ${spec.label} input: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, source.workspacePath);
    const pdfOptions: {
      sourcePath: string;
      workspacePath: string;
      workspaceName: string;
      outputTemplate: string;
      allowedExtensions: readonly string[];
      signal?: AbortSignal;
      report?: (message: string) => void;
      toConversion: (page: number, outputPath: string) => RasterInput;
    } = {
      sourcePath,
      workspacePath: source.workspacePath,
      workspaceName: source.workspaceName,
      outputTemplate: options.splitOutputTemplate,
      allowedExtensions: spec.extensions,
      toConversion: (page: number, outputPath: string): RasterInput => ({
        sourcePath,
        workspacePath: source.workspacePath,
        outputPath,
        page,
      }),
    };
    if (options.signal !== undefined) {
      pdfOptions.signal = options.signal;
    }
    if (options.report !== undefined) {
      pdfOptions.report = options.report;
    }
    return planPdfPageConversionInputs(pdfOptions);
  }

  const splitByFrames = spec.animatedInputExtension !== undefined && options.frameMode === 'all';
  const outputTemplate = splitByFrames ? options.splitOutputTemplate : options.outputTemplate;

  if (spec.animatedInputExtension !== undefined) {
    const inputs = await planAnimationRasterSourceInputs({
      sourcePath,
      workspacePath: source.workspacePath,
      workspaceName: source.workspaceName,
      outputTemplate,
      allowedExtensions: spec.extensions,
      maxInputPixels: options.maxInputPixels,
      maxAnimationPixels: options.maxAnimationPixels ?? 0,
      animatedInputExtension: spec.animatedInputExtension,
      frameMode: options.frameMode,
      ...(options.signal !== undefined && { signal: options.signal }),
      isEditableDrawioImagePath: options.isEditableDrawioImagePath,
    });
    if (inputs !== undefined) {
      return inputs;
    }

    const page = options.isEditableDrawioImagePath(sourcePath) ? '1' : undefined;
    options.signal?.throwIfAborted();
    return [
      {
        sourcePath,
        workspacePath: source.workspacePath,
        outputPath: resolveOutputPath(
          outputTemplate,
          {
            sourcePath: logicalSourcePathForOutputTemplate(sourcePath),
            workspacePath: source.workspacePath,
            workspaceName: source.workspaceName,
            ...(page !== undefined && { page }),
          },
          { allowedExtensions: spec.extensions },
        ),
        ...(page !== undefined && { page: Number(page) }),
      },
    ];
  }

  return planRasterSourceConversionInputs({
    sourcePath,
    workspacePath: source.workspacePath,
    workspaceName: source.workspaceName,
    outputTemplate,
    allowedExtensions: spec.extensions,
    maxInputPixels: options.maxInputPixels,
    ...(options.signal !== undefined && { signal: options.signal }),
    isEditableDrawioImagePath: options.isEditableDrawioImagePath,
  });
}

interface AnimationRasterSourcePlanOptions extends PlanRasterSourceConversionInputsOptions {
  maxAnimationPixels: number;
  animatedInputExtension: string;
  frameMode?: 'first' | 'all';
}

async function planAnimationRasterSourceInputs(
  options: AnimationRasterSourcePlanOptions,
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

export async function planPdfPageConversionInputs<Conversion>(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  signal?: AbortSignal;
  report?: (message: string) => void;
  toConversion: (page: number, outputPath: string) => Conversion;
}): Promise<Conversion[]> {
  options.signal?.throwIfAborted();
  options.report?.('message.progress.analyzingPdf');
  const pageCount = await countPdfPages(await readFile(options.sourcePath));
  options.signal?.throwIfAborted();

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
    options.signal?.throwIfAborted();
    inputs.push(options.toConversion(page, outputPath));
  }
  return inputs;
}
