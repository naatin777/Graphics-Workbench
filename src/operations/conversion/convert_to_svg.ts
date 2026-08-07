import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Parser } from 'xml2js';

import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  isSameSourceFormat,
  sourceFormatForPath,
} from '../../application/policy/source_format.js';
import { getDefaultConfiguration } from '../../generated/extension_manifest.js';
import { convertEpsToPdf } from './eps_to_pdf.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { validateJobPaths } from '../pdf/pdf_utils.js';
import { toErrorMessage } from './raster_conversion.js';
import { isAbortError } from '../../application/error_normalization.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';
import type { DrawioBackend, MermaidBackend, PdftocairoBackend, RunPdfToSvg } from './tools/index.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';
import { runMermaidCliWithSignal } from './tools/run_mermaid_cli.js';
import { runPdftocairoWithAsciiScratch } from '../external_tools/run_pdftocairo_with_ascii_scratch.js';
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
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: { ghostscriptPath: string; platform?: NodeJS.Platform; scratchBaseCandidates?: readonly string[] };
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runtime?: ConversionExecutionContext;
  runPdfToSvg?: RunPdfToSvg;
  runId?: string;
  maxInputPixels?: number;
}

type SvgGhostscriptTools = ConvertToSvgFilesOptions['ghostscriptTools'];

interface SvgRenderTools {
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: SvgGhostscriptTools;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runPdfToSvg: RunPdfToSvg | undefined;
  outputChannel: LineOutputChannel | undefined;
}

interface StageSvgConversionOptions {
  pdftocairoTools: PdftocairoBackend;
  ghostscriptTools: SvgGhostscriptTools;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  runPdfToSvg: RunPdfToSvg | undefined;
  outputChannel: LineOutputChannel | undefined;
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

interface WriteEpsAsSvgOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  ghostscriptTools: SvgGhostscriptTools;
  pdftocairoTools: PdftocairoBackend;
  page: number | undefined;
  runPdfToSvg: RunPdfToSvg | undefined;
  outputChannel: LineOutputChannel | undefined;
  signal: AbortSignal | undefined;
}

interface WritePdfPageAsSvgOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  pdftocairoTools: PdftocairoBackend;
  page: number | undefined;
  runPdfToSvg: RunPdfToSvg | undefined;
  outputChannel: LineOutputChannel | undefined;
  signal: AbortSignal | undefined;
}

export async function convertToSvgFiles(options: ConvertToSvgFilesOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  const maxInputPixels = options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels();
  validateJobs(options.jobs);
  await validateJobPaths(options.jobs, 'convert-to-svg');
  runtime?.signal?.throwIfAborted();

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'convert-to-svg',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      stageSvgConversion(job, index, currentRunId, {
        pdftocairoTools: options.pdftocairoTools,
        ghostscriptTools: options.ghostscriptTools,
        mermaidTools: options.mermaidTools,
        drawioTools: options.drawioTools,
        runPdfToSvg: options.runPdfToSvg,
        outputChannel: batchRuntime.outputChannel,
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
  const {
    pdftocairoTools,
    ghostscriptTools,
    mermaidTools,
    drawioTools,
    runPdfToSvg,
    outputChannel,
    maxInputPixels,
    signal,
  } = options;
  signal?.throwIfAborted();
  const stagingRootPath = createStagingRoot(job.workspacePath, 'convert-to-svg', runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, 'result.svg');

  await writeSourceAsSvg({
    job,
    outputPath: stagedOutputPath,
    tools: {
      pdftocairoTools,
      ghostscriptTools,
      mermaidTools,
      drawioTools,
      runPdfToSvg,
      outputChannel,
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
  const { pdftocairoTools, ghostscriptTools, mermaidTools, drawioTools, runPdfToSvg, outputChannel } = tools;
  const extension = path.extname(job.sourcePath).toLowerCase();

  if (isEditableDrawioImagePath(job.sourcePath) || isNativeDrawioPath(job.sourcePath)) {
    await writeDrawioAsSvg(job.sourcePath, outputPath, job.workspacePath, drawioTools, signal);
    return;
  }

  if (extension === '.eps') {
    await writeEpsAsSvg({
      sourcePath: job.sourcePath,
      outputPath,
      workspacePath: job.workspacePath,
      ghostscriptTools,
      pdftocairoTools,
      page: job.page,
      runPdfToSvg,
      outputChannel,
      signal,
    });
    return;
  }

  if (extension === '.pdf') {
    await writePdfPageAsSvg({
      sourcePath: job.sourcePath,
      outputPath,
      workspacePath: job.workspacePath,
      pdftocairoTools,
      page: job.page,
      runPdfToSvg,
      outputChannel,
      signal,
    });
    return;
  }

  await writeMermaidAsSvg(job.sourcePath, outputPath, job.workspacePath, mermaidTools, signal);
}

async function writeEpsAsSvg({
  sourcePath,
  outputPath,
  workspacePath,
  ghostscriptTools,
  pdftocairoTools,
  page,
  runPdfToSvg,
  outputChannel,
  signal,
}: WriteEpsAsSvgOptions): Promise<void> {
  signal?.throwIfAborted();
  const epsStaging = path.join(path.dirname(outputPath), 'eps-staging');
  await mkdir(epsStaging, { recursive: true });
  signal?.throwIfAborted();

  const epsOptions: Parameters<typeof convertEpsToPdf>[0] = {
    epsPath: sourcePath,
    workspacePath,
    stagingDirectory: epsStaging,
    tools: { ghostscriptPath: ghostscriptTools.ghostscriptPath },
  };
  if (signal !== undefined) {
    epsOptions.signal = signal;
  }
  if (outputChannel !== undefined) {
    epsOptions.outputChannel = outputChannel;
  }
  if (ghostscriptTools.scratchBaseCandidates !== undefined) {
    epsOptions.scratchBaseCandidates = ghostscriptTools.scratchBaseCandidates;
  }
  if (ghostscriptTools.platform !== undefined) {
    epsOptions.platform = ghostscriptTools.platform;
  }

  const { pdfPath } = await convertEpsToPdf(epsOptions);

  signal?.throwIfAborted();
  await writePdfPageAsSvg({
    sourcePath: pdfPath,
    outputPath,
    workspacePath,
    pdftocairoTools,
    page: page ?? 1,
    runPdfToSvg,
    outputChannel,
    signal,
  });
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
  pdftocairoTools,
  page = 1,
  runPdfToSvg,
  outputChannel,
  signal,
}: WritePdfPageAsSvgOptions): Promise<void> {
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  try {
    await runPdftocairoWithAsciiScratch({
      sourcePath,
      outputPath,
      scratchOutputFileName: 'output.svg',
      scratch: pdftocairoTools,
      signal,
      outputChannel,
      run: async (toolSourcePath, toolOutputPath) => {
        if (runPdfToSvg) {
          await runPdfToSvg(toolSourcePath, toolOutputPath, page, signal);
          return;
        }

        await runExternalTool({
          toolName: 'pdftocairo',
          executable: pdftocairoTools.pdftocairoPath,
          args: ['-svg', '-f', String(page), '-l', String(page), toolSourcePath, toolOutputPath],
          ...(signal === undefined ? {} : { signal }),
          ...(outputChannel === undefined ? {} : { outputChannel }),
        });
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`pdftocairo failed: ${toErrorMessage(error)}`, { cause: error });
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

async function executeDrawio(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  await runExternalTool({
    toolName: 'drawio',
    executable,
    args,
    ...(signal !== undefined && { signal }),
  });
}

async function validateGeneratedSvg(outputPath: string): Promise<void> {
  const source = await readFile(outputPath, 'utf8');
  const content = source.trim();

  if (content.length === 0) {
    throw new Error(`SVG conversion produced empty output: ${outputPath}`);
  }

  try {
    const parsed: unknown = await new Parser().parseStringPromise(content);
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
    extension === '.eps' ||
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
