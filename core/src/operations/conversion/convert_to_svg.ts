import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import { matchError } from 'better-result';

import {
  isDrawioImagePath,
  isNativeDrawioPath,
  isSameSourceFormat,
  sourceFormatForPath,
  type SourceFormat,
} from '../../shared/source_format.js';

import { assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { renderPdfPageToSvg } from '../pdf/mupdf.js';
import { validatePdfPathInputs } from '../pdf/pdf_path_validation.js';
import { toErrorMessage, isAbortError, OperationCancelledError } from '../../shared/error.js';
import type { ExternalToolError } from '../external_tools/run_external_tool.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { DrawioBackend } from './tools/drawio_tools.js';
import type { RunPdfToSvg } from './tools/pdf_render_tools.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';

export interface SvgInput {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
}

export interface ConvertToSvgFilesOptions {
  inputs: SvgInput[];
  drawioTools: DrawioBackend;
  runtime: ConversionExecutionContext;
  runPdfToSvg?: RunPdfToSvg;
  runId?: string;
  maxInputPixels: number;
}

interface SvgRenderTools {
  drawioTools: DrawioBackend;
  runPdfToSvg: RunPdfToSvg;
}

interface StageSvgConversionOptions {
  drawioTools: DrawioBackend;
  runPdfToSvg: RunPdfToSvg;
  maxInputPixels: number;
  signal: AbortSignal;
}

interface WriteSourceAsSvgOptions {
  input: SvgInput;
  outputPath: string;
  tools: SvgRenderTools;
  maxInputPixels: number;
  signal: AbortSignal;
}

interface WritePdfPageAsSvgOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page: number | undefined;
  runPdfToSvg: RunPdfToSvg;
  signal: AbortSignal;
}

export async function convertToSvgFiles(options: ConvertToSvgFilesOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime.signal?.throwIfAborted();
  const { maxInputPixels } = options;
  validateConversions(options.inputs);
  await validatePdfPathInputs(options.inputs, 'convert-to-svg');
  runtime.signal?.throwIfAborted();
  const runPdfToSvg = options.runPdfToSvg ?? renderPdfToSvgFile;

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'convert-to-svg',
    runId: options.runId,
    runtime,
    stage: async (input, index, currentRunId, batchRuntime) =>
      stageSvgConversion(input, index, currentRunId, {
        drawioTools: options.drawioTools,
        runPdfToSvg,
        maxInputPixels,
        signal: batchRuntime.signal,
      }),
  });
}

async function renderPdfToSvgFile(
  sourcePath: string,
  outputPath: string,
  page: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const svg = await renderPdfPageToSvg(await readFile(sourcePath), page);
  signal.throwIfAborted();
  await writeFile(outputPath, svg, 'utf8');
}

async function stageSvgConversion(
  input: SvgInput,
  index: number,
  runId: string,
  options: StageSvgConversionOptions,
): Promise<PreparedConversionOutput> {
  const { drawioTools, runPdfToSvg, maxInputPixels, signal } = options;
  signal.throwIfAborted();
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'convert-to-svg', runId);
  const stageDirectory = path.join(stagingRootPath, `${index + 1}`);
  const stagedOutputPath = path.join(stageDirectory, 'result.svg');

  await writeSourceAsSvg({
    input,
    outputPath: stagedOutputPath,
    tools: {
      drawioTools,
      runPdfToSvg,
    },
    maxInputPixels,
    signal,
  });
  signal.throwIfAborted();
  await validateGeneratedSvg(stagedOutputPath);
  signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}

async function writeSourceAsSvg({ input, outputPath, tools, signal }: WriteSourceAsSvgOptions): Promise<void> {
  const { drawioTools, runPdfToSvg } = tools;
  const extension = path.extname(input.sourcePath).toLowerCase();

  if (isDrawioImagePath(input.sourcePath) || isNativeDrawioPath(input.sourcePath)) {
    await writeDrawioAsSvg(input.sourcePath, outputPath, input.workspacePath, drawioTools, signal);
    return;
  }

  if (extension === '.pdf') {
    await writePdfPageAsSvg({
      sourcePath: input.sourcePath,
      outputPath,
      workspacePath: input.workspacePath,
      page: input.page,
      runPdfToSvg,
      signal,
    });
    return;
  }

  throw new Error(`Unsupported input for SVG input: ${input.sourcePath}`);
}

async function writeDrawioAsSvg(
  sourcePath: string,
  outputPath: string,
  workspacePath: string,
  drawio: DrawioBackend,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal.throwIfAborted();

  const result = await drawio.runDrawio(drawio.drawioPath, ['-x', '-f', 'svg', '-o', outputPath, sourcePath], signal);
  if (result.isErr()) {
    throw matchError(result.error, {
      ExternalToolCancelledError: (error) => new OperationCancelledError(error.message),
      ExternalToolTimedOutError: wrapDrawioCliFailure,
      ExternalToolFailedError: wrapDrawioCliFailure,
      ExternalToolSpawnError: wrapDrawioCliFailure,
    });
  }
}

function wrapDrawioCliFailure(error: ExternalToolError): Error {
  return new Error(`Draw.io CLI failed: ${toErrorMessage(error)}`, { cause: error });
}

async function writePdfPageAsSvg({
  sourcePath,
  outputPath,
  workspacePath,
  page = 1,
  runPdfToSvg,
  signal,
}: WritePdfPageAsSvgOptions): Promise<void> {
  signal.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal.throwIfAborted();

  try {
    await runPdfToSvg(sourcePath, outputPath, page, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`PDF to SVG input failed: ${toErrorMessage(error)}`, { cause: error });
  }
}

async function validateGeneratedSvg(outputPath: string): Promise<void> {
  const source = await readFile(outputPath, 'utf8');
  const content = source.trim();

  if (content.length === 0) {
    throw new Error(`SVG input produced empty output: ${outputPath}`);
  }

  try {
    // oxlint-disable-next-line typescript/no-restricted-types -- 外部SVG出力の未検証パース結果。直後のinチェックで検証する境界。
    const parsed: unknown = new XMLParser({ ignoreAttributes: false }).parse(content);
    if (typeof parsed !== 'object' || parsed === null || !('svg' in parsed) || parsed.svg === undefined) {
      throw new Error(`SVG input produced non-SVG output: ${outputPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('non-SVG output')) {
      throw error;
    }

    throw new Error(`SVG input produced invalid SVG output: ${outputPath}`, { cause: error });
  }
}

function validateConversions(inputs: SvgInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No files were selected.');
  }

  for (const input of inputs) {
    if (
      !isDrawioImagePath(input.sourcePath) &&
      !isNativeDrawioPath(input.sourcePath) &&
      isSameSourceFormat(input.sourcePath, '.svg')
    ) {
      throw new Error(`Input and output formats must differ: ${input.sourcePath}`);
    }

    if (!isSupportedSourcePath(input.sourcePath)) {
      throw new Error(`Unsupported input for SVG input: ${input.sourcePath}`);
    }
  }
}

const supportedSvgInputFormats = new Set<SourceFormat>(['pdf', 'drawio', 'drawio-png', 'drawio-svg']);

function isSupportedSourcePath(sourcePath: string): boolean {
  const format = sourceFormatForPath(sourcePath);
  return format !== undefined && supportedSvgInputFormats.has(format);
}
