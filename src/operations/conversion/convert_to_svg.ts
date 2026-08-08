import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  isSameSourceFormat,
  sourceFormatForPath,
} from '../../shared/source_format.js';
import { getDefaultConfiguration } from '../../generated/extension_manifest.js';

import { assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { validatePdfJobPaths } from '../pdf/pdf_job_paths.js';
import { toErrorMessage, isAbortError } from '../../shared/error.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { executeDrawio, type DrawioBackend } from './tools/drawio_tools.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import type { RunPdfToSvg } from './tools/pdf_render_tools.js';
import { runMermaidCliWithSignal } from './tools/run_mermaid_cli.js';
import { renderPdfPageToSvg } from '../pdf/mupdf.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';

export interface ConvertToSvgJob {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
}

export interface ConvertToSvgFilesOptions {
  jobs: ConvertToSvgJob[];
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runtime?: ConversionExecutionContext;
  runPdfToSvg?: RunPdfToSvg;
  runId?: string;
  maxInputPixels?: number;
}

interface SvgRenderTools {
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runPdfToSvg: RunPdfToSvg | undefined;
}

interface StageSvgConversionOptions {
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runPdfToSvg: RunPdfToSvg | undefined;
  maxInputPixels: number;
  signal: AbortSignal | undefined;
}

interface WriteSourceAsSvgOptions {
  job: ConvertToSvgJob;
  outputPath: string;
  tools: SvgRenderTools;
  maxInputPixels: number;
  signal: AbortSignal | undefined;
}

interface WritePdfPageAsSvgOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page: number | undefined;
  runPdfToSvg: RunPdfToSvg | undefined;
  signal: AbortSignal | undefined;
}

export async function convertToSvgFiles(options: ConvertToSvgFilesOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  const maxInputPixels = options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels();
  validateJobs(options.jobs);
  await validatePdfJobPaths(options.jobs, 'convert-to-svg');
  runtime?.signal?.throwIfAborted();

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'convert-to-svg',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      stageSvgConversion(job, index, currentRunId, {
        mermaidTools: options.mermaidTools,
        drawioTools: options.drawioTools,
        runPdfToSvg: options.runPdfToSvg,
        maxInputPixels,
        signal: batchRuntime.signal,
      }),
  });
}

async function stageSvgConversion(
  job: ConvertToSvgJob,
  index: number,
  runId: string,
  options: StageSvgConversionOptions,
): Promise<PreparedConversionOutput> {
  const { mermaidTools, drawioTools, runPdfToSvg, maxInputPixels, signal } = options;
  signal?.throwIfAborted();
  const stagingRootPath = createStagingRoot(job.workspacePath, 'convert-to-svg', runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, 'result.svg');

  await writeSourceAsSvg({
    job,
    outputPath: stagedOutputPath,
    tools: {
      mermaidTools,
      drawioTools,
      runPdfToSvg,
    },
    maxInputPixels,
    signal,
  });
  signal?.throwIfAborted();
  await validateGeneratedSvg(stagedOutputPath);
  signal?.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath,
  };
}

async function writeSourceAsSvg({ job, outputPath, tools, signal }: WriteSourceAsSvgOptions): Promise<void> {
  const { mermaidTools, drawioTools, runPdfToSvg } = tools;
  const extension = path.extname(job.sourcePath).toLowerCase();

  if (isEditableDrawioImagePath(job.sourcePath) || isNativeDrawioPath(job.sourcePath)) {
    await writeDrawioAsSvg(job.sourcePath, outputPath, job.workspacePath, drawioTools, signal);
    return;
  }

  if (extension === '.pdf') {
    await writePdfPageAsSvg({
      sourcePath: job.sourcePath,
      outputPath,
      workspacePath: job.workspacePath,
      page: job.page,
      runPdfToSvg,
      signal,
    });
    return;
  }

  await writeMermaidAsSvg(job.sourcePath, outputPath, job.workspacePath, mermaidTools, signal);
}

async function writeDrawioAsSvg(
  sourcePath: string,
  outputPath: string,
  workspacePath: string,
  drawio: DrawioBackend,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  try {
    await (drawio.runDrawio ?? executeDrawio)(
      drawio.drawioPath,
      ['-x', '-f', 'svg', '-o', outputPath, sourcePath],
      signal,
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`Draw.io CLI failed: ${toErrorMessage(error)}`, { cause: error });
  }
}

async function writePdfPageAsSvg({
  sourcePath,
  outputPath,
  workspacePath,
  page = 1,
  runPdfToSvg,
  signal,
}: WritePdfPageAsSvgOptions): Promise<void> {
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  try {
    if (runPdfToSvg) {
      await runPdfToSvg(sourcePath, outputPath, page, signal);
    } else {
      const pdfBytes = await readFile(sourcePath);
      signal?.throwIfAborted();
      const svg = await renderPdfPageToSvg(pdfBytes, page);
      signal?.throwIfAborted();
      await writeFile(outputPath, svg, 'utf8');
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`PDF to SVG conversion failed: ${toErrorMessage(error)}`, { cause: error });
  }
}

async function writeMermaidAsSvg(
  sourcePath: string,
  outputPath: string,
  workspacePath: string,
  mermaid: MermaidBackend,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  try {
    await runMermaidCliWithSignal(
      {
        sourcePath,
        outputPath: asSvgOutputPath(outputPath),
        outputFormat: 'svg',
        mermaidPath: mermaid.mermaidPath,
        chromePath: mermaid.chromePath,
        theme: mermaid.theme,
        backgroundColor: mermaid.backgroundColor,
      },
      signal,
    );
    signal?.throwIfAborted();
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`Mermaid CLI failed: ${toErrorMessage(error)}`, { cause: error });
  }
}

async function validateGeneratedSvg(outputPath: string): Promise<void> {
  const source = await readFile(outputPath, 'utf8');
  const content = source.trim();

  if (content.length === 0) {
    throw new Error(`SVG conversion produced empty output: ${outputPath}`);
  }

  try {
    const parsed: unknown = new XMLParser({ ignoreAttributes: false }).parse(content);
    if (typeof parsed !== 'object' || parsed === null || !('svg' in parsed) || parsed.svg === undefined) {
      throw new Error(`SVG conversion produced non-SVG output: ${outputPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('non-SVG output')) {
      throw error;
    }

    throw new Error(`SVG conversion produced invalid SVG output: ${outputPath}`, { cause: error });
  }
}

function validateJobs(jobs: ConvertToSvgJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No files were selected.');
  }

  for (const job of jobs) {
    if (
      !isEditableDrawioImagePath(job.sourcePath) &&
      !isNativeDrawioPath(job.sourcePath) &&
      isSameSourceFormat(job.sourcePath, '.svg')
    ) {
      throw new Error(`Input and output formats must differ: ${job.sourcePath}`);
    }

    if (!isSupportedSourcePath(job.sourcePath)) {
      throw new Error(`Unsupported input for SVG conversion: ${job.sourcePath}`);
    }
  }
}

function isSupportedSourcePath(sourcePath: string): boolean {
  const extension = path.extname(sourcePath).toLowerCase();

  return (
    extension === '.pdf' ||
    sourceFormatForPath(sourcePath) === 'mermaid' ||
    isEditableDrawioImagePath(sourcePath) ||
    isNativeDrawioPath(sourcePath)
  );
}

function asSvgOutputPath(outputPath: string): `${string}.svg` {
  if (!isSvgOutputPath(outputPath)) {
    throw new Error(`SVG output path must end with .svg: ${outputPath}`);
  }

  return outputPath;
}

function isSvgOutputPath(outputPath: string): outputPath is `${string}.svg` {
  return outputPath.toLowerCase().endsWith('.svg');
}
