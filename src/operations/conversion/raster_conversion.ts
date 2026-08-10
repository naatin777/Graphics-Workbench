import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isEditableDrawioImagePath,
  isMermaidPath,
  isNativeDrawioPath,
  isSameSourceFormat,
  isSupportedImageInputPath,
} from '../../shared/source_format.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { isAbortError, toErrorMessage } from '../../shared/error.js';
import { countPdfPages, hasPdfPageContent, renderPdfPageToPng } from '../pdf/mupdf.js';

import {
  isRasterInputPixelLimitError,
  formatRasterInputPixelLimitMessage,
  openRasterInput,
  type RasterAnimationMetadata,
} from './raster_input.js';
// oxlint-disable-next-line unicorn/prefer-export-from -- CommittedConversionOutput is used locally and re-exported.
import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';

export type { CommittedConversionOutput };
import type { ConversionExecutionContext, ResolvedConversionRuntime } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend } from './tools/drawio_tools.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import type { PdfRenderBackend } from './tools/pdf_render_tools.js';

import { runMermaidCliWithSignal } from './tools/run_mermaid_cli.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import sharp from 'sharp';

export type RasterConversionTarget = 'png' | 'jpeg' | 'avif' | 'tiff' | 'webp' | 'gif';

export interface RasterFormatSpec {
  target: RasterConversionTarget;
  operationName: string;
  outputLabel: 'PNG' | 'JPEG' | 'AVIF' | 'TIFF' | 'WebP' | 'GIF';
  label: string;
  extensions: readonly string[];
  splitOutputTemplate?: string;
  animatedInputExtension?: string;
}

export const rasterFormatSpecs = {
  png: {
    target: 'png',
    operationName: 'convert-to-png',
    outputLabel: 'PNG',
    extensions: ['.png'],
    label: 'PNG',
  },
  jpeg: {
    target: 'jpeg',
    operationName: 'convert-to-jpeg',
    outputLabel: 'JPEG',
    extensions: ['.jpg', '.jpeg'],
    label: 'JPEG',
  },
  avif: {
    target: 'avif',
    operationName: 'convert-to-avif',
    outputLabel: 'AVIF',
    extensions: ['.avif'],
    label: 'AVIF',
  },
  tiff: {
    target: 'tiff',
    operationName: 'convert-to-tiff',
    outputLabel: 'TIFF',
    extensions: ['.tif', '.tiff'],
    label: 'TIFF',
  },
  webp: {
    target: 'webp',
    operationName: 'convert-to-webp',
    outputLabel: 'WebP',
    extensions: ['.webp'],
    label: 'WebP',
    splitOutputTemplate: '${fileDirname}/${fileBasenameNoExtension}-${page}.webp',
    animatedInputExtension: '.gif',
  },
  gif: {
    target: 'gif',
    operationName: 'convert-to-gif',
    outputLabel: 'GIF',
    extensions: ['.gif'],
    label: 'GIF',
    splitOutputTemplate: '${fileDirname}/${fileBasenameNoExtension}-${page}.gif',
    animatedInputExtension: '.webp',
  },
} as const satisfies Record<RasterConversionTarget, RasterFormatSpec>;

export interface RasterJob {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
  animation?: RasterAnimationMetadata;
}

interface ExecuteRasterConversionBatchOptions {
  jobs: RasterJob[];
  runtime: ConversionExecutionContext;
  pdfRenderTools: PdfRenderBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  maxInputPixels: number;
  runId?: string;
  spec: RasterFormatSpec;
  outputOptions?: AvifOutputOptions | WebpOutputOptions;
}

interface RasterStageContext {
  runId: string;
  runtime: ResolvedConversionRuntime;
  pdfRenderTools: PdfRenderBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  spec: RasterFormatSpec;
  outputOptions?: AvifOutputOptions | WebpOutputOptions;
  maxInputPixels: number;
}

interface RasterStagePaths {
  stageDirectory: string;
  stagedOutputPath: string;
  stagingRootPath: string;
}

interface RasterRenderRequest {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  stageDirectory?: string;
  page?: number;
  animation?: RasterAnimationMetadata;
  cropContent?: boolean;
}

async function executeRasterConversionBatch(
  options: ExecuteRasterConversionBatchOptions,
): Promise<CommittedConversionOutput[]> {
  options.runtime.signal?.throwIfAborted();
  validateJobs(options.jobs, options.spec);
  await validateJobPaths(options.jobs, options.spec.operationName);
  options.runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: options.spec.operationName,
    runId: options.runId,
    runtime: options.runtime,
    stage: async (job, index, stageRunId, stageRuntime) =>
      stageRasterConversion(job, index, {
        runId: stageRunId,
        runtime: stageRuntime,
        pdfRenderTools: options.pdfRenderTools,
        mermaidTools: options.mermaidTools,
        drawioTools: options.drawioTools,
        spec: options.spec,
        ...(options.outputOptions !== undefined && { outputOptions: options.outputOptions }),
        maxInputPixels: options.maxInputPixels,
      }),
  });
}

async function stageRasterConversion(
  job: RasterJob,
  index: number,
  context: RasterStageContext,
): Promise<PreparedConversionOutput> {
  context.runtime.signal.throwIfAborted();
  const resultExtension = context.spec.target;
  const stagingRootPath = stagingRootPathFor(job.workspacePath, context.spec.operationName, context.runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, `result.${resultExtension}`);

  await writeSourceAsRaster(job, { stageDirectory, stagedOutputPath, stagingRootPath }, context);
  context.runtime.signal.throwIfAborted();
  await validateGeneratedRaster(stagedOutputPath, resultExtension);
  context.runtime.signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath,
  };
}

async function writeSourceAsRaster(
  job: RasterJob,
  paths: RasterStagePaths,
  context: RasterStageContext,
): Promise<void> {
  const { sourcePath } = job;
  const extension = path.extname(sourcePath).toLowerCase();

  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    await writeDrawioAsRaster(job, paths, context);
    return;
  }

  const request: RasterRenderRequest = {
    sourcePath,
    outputPath: paths.stagedOutputPath,
    workspacePath: job.workspacePath,
    stageDirectory: paths.stageDirectory,
  };
  if (job.page !== undefined) {
    request.page = job.page;
  }
  if (job.animation !== undefined) {
    request.animation = job.animation;
  }

  if (extension === '.pdf') {
    await writePdfPageAsRaster(request, context);
    return;
  }

  if (isMermaidPath(sourcePath)) {
    await writeMermaidAsRaster(request, context);
    return;
  }

  await writeImageAsRaster(request, context);
}

async function writeDrawioAsRaster(
  job: RasterJob,
  paths: RasterStagePaths,
  context: RasterStageContext,
): Promise<void> {
  context.runtime.signal.throwIfAborted();
  const pdfPath = path.join(paths.stageDirectory, 'drawio.pdf');
  await assertWritablePathInWorkspace(pdfPath, job.workspacePath);
  await mkdir(path.dirname(pdfPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  await context.drawioTools.runDrawio(
    context.drawioTools.drawioPath,
    ['-x', '-f', 'pdf', '-o', pdfPath, job.sourcePath],
    context.runtime.signal,
  );

  // Draw.io PDF exports leave white margins even with --crop, so crop each
  // page to its drawn content. Without an explicit page, use the first page
  // that actually contains content. The page scan needs a real PDF.
  const pdfBytes = await readFile(pdfPath);
  let page = job.page ?? 1;
  if (job.page === undefined) {
    const pageCount = await countPdfPages(pdfBytes);
    for (let candidate = 1; candidate <= pageCount; candidate += 1) {
      context.runtime.signal.throwIfAborted();
      if (await hasPdfPageContent(pdfBytes, candidate)) {
        page = candidate;
        break;
      }
    }
  }

  await writePdfPageAsRaster(
    {
      sourcePath: pdfPath,
      outputPath: paths.stagedOutputPath,
      workspacePath: job.workspacePath,
      stageDirectory: paths.stageDirectory,
      page,
      cropContent: true,
    },
    context,
  );
}

async function writePdfPageAsRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  const pngPath = path.join(request.stageDirectory ?? path.dirname(request.outputPath), 'source.png');
  context.runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(pngPath, request.workspacePath);
  await mkdir(path.dirname(pngPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  if (context.pdfRenderTools.runPdfToPng) {
    await context.pdfRenderTools.runPdfToPng(request.sourcePath, pngPath, request.page ?? 1, context.runtime.signal);
  } else {
    const pdfBytes = await readFile(request.sourcePath);
    context.runtime.signal.throwIfAborted();
    const png = await renderPdfPageToPng(pdfBytes, request.page ?? 1, {
      ...(request.cropContent !== undefined && { cropContent: request.cropContent }),
    });
    context.runtime.signal.throwIfAborted();
    await writeFile(pngPath, png);
  }
  context.runtime.signal.throwIfAborted();

  await writeImageAsRaster({ ...request, sourcePath: pngPath }, context);
}

async function writeMermaidAsRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  const pngPath = path.join(request.stageDirectory ?? path.dirname(request.outputPath), 'mermaid.png');
  context.runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(pngPath, request.workspacePath);
  await mkdir(path.dirname(pngPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  try {
    await runMermaidCliWithSignal(
      {
        sourcePath: request.sourcePath,
        outputPath: asPngOutputPath(pngPath),
        outputFormat: 'png',
        mermaidPath: context.mermaidTools.mermaidPath,
        chromePath: context.mermaidTools.chromePath,
        theme: context.mermaidTools.theme,
        backgroundColor: context.mermaidTools.backgroundColor,
      },
      context.runtime.signal,
    );
    context.runtime.signal.throwIfAborted();
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`Mermaid CLI failed: ${toErrorMessage(error)}`, { cause: error });
  }

  await writeImageAsRaster({ ...request, sourcePath: pngPath }, context);
}

async function writeImageAsRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  context.runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(request.outputPath, request.workspacePath);
  await mkdir(path.dirname(request.outputPath), { recursive: true });
  context.runtime.signal.throwIfAborted();

  try {
    await encodeRaster(request, context);
  } catch (error) {
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(context.maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function encodeRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  const input = openRasterInput(
    request.sourcePath,
    context.maxInputPixels,
    request.page,
    request.animation !== undefined,
  );

  switch (context.spec.target) {
    case 'png': {
      await input.png().toFile(request.outputPath);
      return;
    }
    case 'jpeg': {
      await input.jpeg().toFile(request.outputPath);
      return;
    }
    case 'tiff': {
      await input.tiff().toFile(request.outputPath);
      return;
    }
    case 'avif': {
      await input.avif(context.outputOptions).toFile(request.outputPath);
      return;
    }
    case 'gif': {
      await input.gif(animationEncoderOptions(request.animation)).toFile(request.outputPath);
      return;
    }
    case 'webp': {
      await input
        .webp({ ...context.outputOptions, ...animationEncoderOptions(request.animation) })
        .toFile(request.outputPath);
    }
  }
}

function animationEncoderOptions(animation: RasterAnimationMetadata | undefined): { delay?: number[]; loop?: number } {
  const options: { delay?: number[]; loop?: number } = {};
  if (animation?.delay !== undefined) {
    options.delay = animation.delay;
  }
  if (animation?.loop !== undefined) {
    options.loop = animation.loop;
  }
  return options;
}

async function validateJobPaths(jobs: RasterJob[], stagingDirectoryName: string): Promise<void> {
  await Promise.all(
    jobs.flatMap((job) => [
      assertExistingPathInWorkspace(job.sourcePath, job.workspacePath),
      assertWritablePathInWorkspace(job.outputPath, job.workspacePath),
      assertWritablePathInWorkspace(
        path.join(job.workspacePath, '.graphics-workbench', stagingDirectoryName),
        job.workspacePath,
      ),
    ]),
  );
}

function validateJobs(jobs: RasterJob[], spec: RasterFormatSpec): void {
  if (jobs.length === 0) {
    throw new Error('No files were selected.');
  }

  for (const job of jobs) {
    if (
      !isEditableDrawioImagePath(job.sourcePath) &&
      !isNativeDrawioPath(job.sourcePath) &&
      isSameSourceFormat(job.sourcePath, spec.target)
    ) {
      throw new Error(`Input and output formats must differ: ${job.sourcePath}`);
    }

    if (!isSupportedSourcePath(job.sourcePath)) {
      throw new Error(`Unsupported input for ${spec.outputLabel} conversion: ${job.sourcePath}`);
    }
  }
}

async function validateGeneratedRaster(outputPath: string, outputExtension: string): Promise<void> {
  const metadata = await sharp(outputPath).metadata();
  const expectedFormat = outputExtension === 'avif' ? 'heif' : outputExtension;

  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error(`Raster conversion produced invalid ${outputExtension.toUpperCase()} output: ${outputPath}`);
  }
}

function isSupportedSourcePath(sourcePath: string): boolean {
  const extension = path.extname(sourcePath).toLowerCase();

  return (
    extension === '.pdf' ||
    extension === '.svg' ||
    isMermaidPath(sourcePath) ||
    isSupportedImageInputPath(sourcePath) ||
    isEditableDrawioImagePath(sourcePath) ||
    isNativeDrawioPath(sourcePath)
  );
}

function asPngOutputPath(outputPath: string): `${string}.png` {
  if (!isPngOutputPath(outputPath)) {
    throw new Error(`PNG output path must end with .png: ${outputPath}`);
  }

  return outputPath;
}

function isPngOutputPath(outputPath: string): outputPath is `${string}.png` {
  return outputPath.toLowerCase().endsWith('.png');
}

interface AvifOutputOptions {
  effort: number;
}

interface WebpOutputOptions {
  effort: number;
}

export interface ExecuteRasterConversionOptions {
  jobs: RasterJob[];
  runtime: ConversionExecutionContext;
  pdfRenderTools: PdfRenderBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  maxInputPixels: number;
  runId?: string;
  spec: RasterFormatSpec;
  outputOptions?: AvifOutputOptions | WebpOutputOptions;
}

export async function executeRasterConversion(
  options: ExecuteRasterConversionOptions,
): Promise<CommittedConversionOutput[]> {
  return executeRasterConversionBatch({
    ...options,
  });
}
