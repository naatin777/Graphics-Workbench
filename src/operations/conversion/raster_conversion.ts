import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isEditableDrawioImagePath,
  isMermaidPath,
  isNativeDrawioPath,
  isSameSourceFormat,
  isSupportedImageInputPath,
} from '../../application/policy/source_format.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { getDefaultConfiguration } from '../../generated/extension_manifest.js';
import { isAbortError } from '../../application/error_normalization.js';
import { countPdfPages, hasPdfPageContent, renderPdfPageToPng } from '../pdf/mupdf.js';

import {
  isRasterInputPixelLimitError,
  formatRasterInputPixelLimitMessage,
  type RasterAnimationMetadata,
} from './raster_input.js';
// oxlint-disable-next-line unicorn/prefer-export-from -- CommittedConversionOutput is used locally and re-exported.
import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';

export type { CommittedConversionOutput };
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend, MermaidBackend, PdfRenderBackend } from './tools/index.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';
import { runMermaidCliWithSignal } from './tools/run_mermaid_cli.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import sharp from 'sharp';

type RasterEncoder = (
  sourcePath: string,
  outputPath: string,
  maxInputPixels: number,
  page?: number,
  animation?: RasterAnimationMetadata,
) => Promise<void>;

export interface RasterConversionDefinition {
  operationName: string;
  stagingDirectoryName: string;
  resultExtension: string;
  encoder: RasterEncoder;
  unsupportedInputMessage: (sourcePath: string) => string;
}

export interface SimpleRasterConversionOptions {
  operationName: string;
  resultExtension: string;
  encoder: RasterEncoder;
}

type SimpleRasterExecutor = (
  batchOptions: Omit<ExecuteRasterConversionBatchOptions, 'definition' | 'maxInputPixels'> & {
    maxInputPixels?: number;
  },
) => Promise<CommittedConversionOutput[]>;

export function createSimpleRasterExecutor(options: SimpleRasterConversionOptions): SimpleRasterExecutor {
  const definition: RasterConversionDefinition = {
    operationName: options.operationName,
    stagingDirectoryName: options.operationName,
    resultExtension: options.resultExtension,
    encoder: options.encoder,
    unsupportedInputMessage: (sourcePath) =>
      `Unsupported input for ${options.resultExtension.toUpperCase()} conversion: ${sourcePath}`,
  };

  return async (
    batchOptions: Omit<ExecuteRasterConversionBatchOptions, 'definition' | 'maxInputPixels'> & {
      maxInputPixels?: number;
    },
  ): Promise<CommittedConversionOutput[]> =>
    executeRasterConversionBatch({
      ...batchOptions,
      maxInputPixels: batchOptions.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels(),
      definition,
    });
}

export interface RasterJob {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
  animation?: RasterAnimationMetadata;
}

export interface ExecuteRasterConversionBatchOptions {
  jobs: RasterJob[];
  runtime: ConversionExecutionContext;
  pdfRenderTools: PdfRenderBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  maxInputPixels: number;
  runId?: string | undefined;
  definition: RasterConversionDefinition;
}

interface RasterStageContext {
  runId: string;
  runtime: ConversionExecutionContext;
  pdfRenderTools: PdfRenderBackend;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  definition: RasterConversionDefinition;
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

export async function executeRasterConversionBatch(
  options: ExecuteRasterConversionBatchOptions,
): Promise<CommittedConversionOutput[]> {
  options.runtime.signal?.throwIfAborted();
  validateJobs(options.jobs, options.definition);
  await validateJobPaths(options.jobs, options.definition.stagingDirectoryName);
  options.runtime.signal?.throwIfAborted();

  await assertPreflightPassed(preflightOptionsFromRuntime(options.runtime));
  options.runtime.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();
  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: options.definition.operationName,
    runId,
    runtime: options.runtime,
    stage: async (job, index, stageRunId, stageRuntime) =>
      stageRasterConversion(job, index, {
        runId: stageRunId,
        runtime: stageRuntime,
        pdfRenderTools: options.pdfRenderTools,
        mermaidTools: options.mermaidTools,
        drawioTools: options.drawioTools,
        definition: options.definition,
        maxInputPixels: options.maxInputPixels,
      }),
  });
}

async function stageRasterConversion(
  job: RasterJob,
  index: number,
  context: RasterStageContext,
): Promise<PreparedConversionOutput> {
  context.runtime.signal?.throwIfAborted();
  const { stagingDirectoryName, resultExtension } = context.definition;
  const stagingRootPath = createStagingRoot(job.workspacePath, stagingDirectoryName, context.runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, `result.${resultExtension}`);

  await writeSourceAsRaster(job, { stageDirectory, stagedOutputPath, stagingRootPath }, context);
  context.runtime.signal?.throwIfAborted();
  await validateGeneratedRaster(stagedOutputPath, resultExtension);
  context.runtime.signal?.throwIfAborted();

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
  context.runtime.signal?.throwIfAborted();
  const pdfPath = path.join(paths.stageDirectory, 'drawio.pdf');
  await assertWritablePathInWorkspace(pdfPath, job.workspacePath);
  await mkdir(path.dirname(pdfPath), { recursive: true });
  context.runtime.signal?.throwIfAborted();

  await (context.drawioTools.runDrawio ?? executeDrawio)(
    context.drawioTools.drawioPath,
    ['-x', '-f', 'pdf', '-o', pdfPath, job.sourcePath],
    context.runtime.signal,
  );

  // Draw.io PDF exports leave white margins even with --crop, so crop each
  // page to its drawn content. Without an explicit page, use the first page
  // that actually contains content. The page scan needs a real PDF, so it is
  // skipped when a test injects a fake drawio runner.
  const pdfBytes = await readFile(pdfPath);
  let page = job.page ?? 1;
  if (job.page === undefined && context.drawioTools.runDrawio === undefined) {
    const pageCount = await countPdfPages(pdfBytes);
    for (let candidate = 1; candidate <= pageCount; candidate += 1) {
      context.runtime.signal?.throwIfAborted();
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
  context.runtime.signal?.throwIfAborted();
  await assertWritablePathInWorkspace(pngPath, request.workspacePath);
  await mkdir(path.dirname(pngPath), { recursive: true });
  context.runtime.signal?.throwIfAborted();

  if (context.pdfRenderTools.runPdfToPng) {
    await context.pdfRenderTools.runPdfToPng(request.sourcePath, pngPath, request.page ?? 1, context.runtime.signal);
  } else {
    const pdfBytes = await readFile(request.sourcePath);
    context.runtime.signal?.throwIfAborted();
    const png = await renderPdfPageToPng(pdfBytes, request.page ?? 1, {
      cropContent: request.cropContent,
    });
    context.runtime.signal?.throwIfAborted();
    await writeFile(pngPath, png);
  }
  context.runtime.signal?.throwIfAborted();

  await writeImageAsRaster({ ...request, sourcePath: pngPath }, context);
}

async function writeMermaidAsRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  const pngPath = path.join(request.stageDirectory ?? path.dirname(request.outputPath), 'mermaid.png');
  context.runtime.signal?.throwIfAborted();
  await assertWritablePathInWorkspace(pngPath, request.workspacePath);
  await mkdir(path.dirname(pngPath), { recursive: true });
  context.runtime.signal?.throwIfAborted();

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
    context.runtime.signal?.throwIfAborted();
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`Mermaid CLI failed: ${toErrorMessage(error)}`, { cause: error });
  }

  await writeImageAsRaster({ ...request, sourcePath: pngPath }, context);
}

async function writeImageAsRaster(request: RasterRenderRequest, context: RasterStageContext): Promise<void> {
  context.runtime.signal?.throwIfAborted();
  await assertWritablePathInWorkspace(request.outputPath, request.workspacePath);
  await mkdir(path.dirname(request.outputPath), { recursive: true });
  context.runtime.signal?.throwIfAborted();

  try {
    await context.definition.encoder(
      request.sourcePath,
      request.outputPath,
      context.maxInputPixels,
      request.page,
      request.animation,
    );
  } catch (error) {
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(context.maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function executeDrawio(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  await runExternalTool({
    toolName: 'drawio',
    executable,
    args,
    ...(signal !== undefined && { signal }),
  });
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

function validateJobs(jobs: RasterJob[], definition: RasterConversionDefinition): void {
  if (jobs.length === 0) {
    throw new Error('No files were selected.');
  }

  for (const job of jobs) {
    if (
      !isEditableDrawioImagePath(job.sourcePath) &&
      !isNativeDrawioPath(job.sourcePath) &&
      isSameSourceFormat(job.sourcePath, definition.resultExtension)
    ) {
      throw new Error(`Input and output formats must differ: ${job.sourcePath}`);
    }

    if (!isSupportedSourcePath(job.sourcePath)) {
      throw new Error(definition.unsupportedInputMessage(job.sourcePath));
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

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    return stderr ? `${error.message}\n${stderr}` : error.message;
  }

  return String(error);
}
