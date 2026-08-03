import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, type PDFPage } from 'pdf-lib';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { safeName, validateJobPaths } from './pdf_utils.js';

import {
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import {
  createAsciiInputScratch,
  defaultWindowsScratchBaseCandidates,
  removeSuccessfulScratch,
  validateAsciiScratchInput,
  type AsciiScratch,
  type LineOutputChannel,
} from '../external_tools/external_tool_ascii_scratch.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';

export interface CropPdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
}

interface GhostscriptResult {
  stdout: string;
  stderr: string;
}

export type RunGhostscript = (executable: string, args: string[], signal?: AbortSignal) => Promise<GhostscriptResult>;

export interface CropPdfOptions {
  jobs: CropPdfJob[];
  margin: number;
  ghostscriptPath: string;
  runtime?: ConversionExecutionContext;
  runId?: string;
  runGhostscript?: RunGhostscript;
  platform?: NodeJS.Platform;
  scratchBaseCandidates?: readonly string[];
}

interface Box {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export async function cropPdfFiles(options: CropPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  validateMargin(options.margin);
  await validateJobPaths(options.jobs, 'crop-pdf');

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  if (!runtime?.resolveConflicts) {
    await assertOutputsDoNotExist(options.jobs);
  }

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();
  const runGhostscript = options.runGhostscript ?? executeGhostscript;
  const platform = options.platform ?? process.platform;
  const scratchBaseCandidates = options.scratchBaseCandidates ?? defaultWindowsScratchBaseCandidates();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'crop-pdf-auto',
    stagingOperationName: 'crop-pdf',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      convertPdf({
        job,
        index,
        margin: options.margin,
        runId: currentRunId,
        tools: {
          ghostscriptPath: options.ghostscriptPath,
          runGhostscript,
          platform,
          scratchBaseCandidates,
        },
        runtime: {
          signal: batchRuntime.signal,
          ...(batchRuntime.outputChannel !== undefined && { outputChannel: batchRuntime.outputChannel }),
        },
      }),
  });
}

async function convertPdf(params: {
  job: CropPdfJob;
  index: number;
  margin: number;
  runId: string;
  tools: {
    ghostscriptPath: string;
    runGhostscript: RunGhostscript;
    platform: NodeJS.Platform;
    scratchBaseCandidates: readonly string[];
  };
  runtime: {
    signal: AbortSignal | undefined;
    outputChannel?: LineOutputChannel;
  };
}): Promise<PreparedConversionOutput> {
  const { job, index, margin, runId, tools, runtime } = params;
  const { ghostscriptPath, runGhostscript, platform, scratchBaseCandidates } = tools;
  const { signal, outputChannel } = runtime;
  signal?.throwIfAborted();
  const itemName = `${index + 1}-${safeName(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = createStagingRoot(job.workspacePath, 'crop-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const copiedSourcePath = path.join(workDirectory, path.basename(job.sourcePath));
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(job.sourcePath, job.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, job.workspacePath);
  signal?.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  await copyFileWithAbort(job.sourcePath, copiedSourcePath, undefined, signal);

  let scratch: AsciiScratch | undefined;

  try {
    await assertExistingPathInWorkspace(copiedSourcePath, job.workspacePath);
    signal?.throwIfAborted();
    const preparedInput = await prepareGhostscriptInput({
      sourcePath: job.sourcePath,
      copiedSourcePath,
      platform,
      scratchBaseCandidates,
      signal,
      outputChannel,
    });
    scratch = preparedInput.scratch;
    const document = await cropDocument({
      sourcePath: job.sourcePath,
      copiedSourcePath,
      ghostscriptInputPath: preparedInput.ghostscriptInputPath,
      ghostscriptPath,
      runGhostscript,
      signal,
      outputChannel,
      margin,
    });

    await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
    signal?.throwIfAborted();
    await writeFile(stagedOutputPath, await document.save());
    signal?.throwIfAborted();

    if (scratch) {
      await removeSuccessfulScratch(scratch, outputChannel);
    }

    return {
      stagedOutputPath,
      outputPath: job.outputPath,
      workspacePath: job.workspacePath,
      stagingRootPath,
    };
  } catch (error) {
    if (scratch) {
      outputChannel?.appendLine(`[scratch] retained after failure: ${scratch.rootPath}`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function prepareGhostscriptInput(options: {
  sourcePath: string;
  copiedSourcePath: string;
  platform: NodeJS.Platform;
  scratchBaseCandidates: readonly string[];
  signal: AbortSignal | undefined;
  outputChannel: LineOutputChannel | undefined;
}): Promise<{ ghostscriptInputPath: string; scratch?: AsciiScratch }> {
  if (options.platform !== 'win32') {
    return { ghostscriptInputPath: options.copiedSourcePath };
  }

  const scratchArgs: Parameters<typeof createAsciiInputScratch>[0] = {
    baseCandidates: options.scratchBaseCandidates,
    inputFileName: 'input.pdf',
  };
  if (options.signal !== undefined) {
    scratchArgs.signal = options.signal;
  }
  if (options.outputChannel !== undefined) {
    scratchArgs.outputChannel = options.outputChannel;
  }
  const scratch = await createAsciiInputScratch(scratchArgs);
  try {
    options.signal?.throwIfAborted();
    await copyFileWithAbort(options.copiedSourcePath, scratch.inputPath, undefined, options.signal);
    options.signal?.throwIfAborted();
    await validateAsciiScratchInput(scratch);
    options.outputChannel?.appendLine(`[scratch] logical input: ${options.sourcePath}`);
    options.outputChannel?.appendLine(`[scratch] tool input: ${scratch.inputPath}`);
    return { ghostscriptInputPath: scratch.inputPath, scratch };
  } catch (error) {
    options.outputChannel?.appendLine(`[scratch] retained after failure: ${scratch.rootPath}`);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function cropDocument(options: {
  sourcePath: string;
  copiedSourcePath: string;
  ghostscriptInputPath: string;
  ghostscriptPath: string;
  runGhostscript: RunGhostscript;
  signal: AbortSignal | undefined;
  outputChannel: LineOutputChannel | undefined;
  margin: number;
}): Promise<PDFDocument> {
  const boundingBoxes = await readBoundingBoxes(
    options.ghostscriptPath,
    options.ghostscriptInputPath,
    options.runGhostscript,
    options.signal,
    options.outputChannel,
  );
  options.signal?.throwIfAborted();
  const document = await PDFDocument.load(await readFile(options.copiedSourcePath));
  options.signal?.throwIfAborted();
  const pages = document.getPages();

  if (boundingBoxes.length !== pages.length || pages.length === 0) {
    throw new Error(`Could not determine all PDF page bounds: ${options.sourcePath}`);
  }

  for (const [pageIndex, page] of pages.entries()) {
    options.signal?.throwIfAborted();
    const boundingBox = boundingBoxes[pageIndex];
    if (!boundingBox) {
      throw new Error(`Missing page bounds for page ${pageIndex + 1}: ${options.sourcePath}`);
    }
    setPageBounds(page, boundingBox, options.margin);
  }

  return document;
}

async function readBoundingBoxes(
  ghostscriptPath: string,
  sourcePath: string,
  runGhostscript: RunGhostscript,
  signal?: AbortSignal,
  outputChannel?: LineOutputChannel,
): Promise<Box[]> {
  try {
    const result = await runGhostscript(
      ghostscriptPath,
      ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=bbox', sourcePath],
      signal,
    );

    return parseBoundingBoxes(result.stderr);
  } catch (error) {
    if (outputChannel) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`Ghostscript error: ${message}`);
      outputChannel.appendLine(`Command: ${ghostscriptPath}`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function setPageBounds(page: PDFPage, boundingBox: Box, margin: number): void {
  if (isEmptyBox(boundingBox)) {
    const mediaBox = page.getMediaBox();
    page.setCropBox(mediaBox.x, mediaBox.y, mediaBox.width, mediaBox.height);
    return;
  }

  const cropBox = addMargin(boundingBox, margin);
  const width = cropBox.right - cropBox.left;
  const height = cropBox.top - cropBox.bottom;

  page.setMediaBox(cropBox.left, cropBox.bottom, width, height);
  page.setCropBox(cropBox.left, cropBox.bottom, width, height);
}

function validateJobs(jobs: CropPdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be cropped: ${job.sourcePath}`);
    }
  }
}

function validateMargin(margin: number): void {
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(`Crop margin must be a non-negative number: ${margin}`);
  }
}

async function assertOutputsDoNotExist(jobs: CropPdfJob[]): Promise<void> {
  const normalizedOutputs = new Set<string>();

  for (const job of jobs) {
    const normalizedOutput = path.resolve(job.outputPath);

    if (normalizedOutputs.has(normalizedOutput)) {
      throw new Error(`Multiple inputs resolve to the same output: ${job.outputPath}`);
    }
    normalizedOutputs.add(normalizedOutput);

    try {
      await access(job.outputPath);
      throw new Error(`Output file already exists: ${job.outputPath}`);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        continue;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

export function parseBoundingBoxes(output: string): Box[] {
  const pattern =
    /^%%HiResBoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/gm;

  return [...output.matchAll(pattern)].map((match) => ({
    left: Number(match[1]),
    bottom: Number(match[2]),
    right: Number(match[3]),
    top: Number(match[4]),
  }));
}

function addMargin(box: Box, margin: number): Box {
  return {
    left: box.left - margin,
    bottom: box.bottom - margin,
    right: box.right + margin,
    top: box.top + margin,
  };
}

function isEmptyBox(box: Box): boolean {
  return box.left === box.right || box.bottom === box.top;
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function executeGhostscript(
  executable: string,
  args: string[],
  signal?: AbortSignal,
): Promise<GhostscriptResult> {
  return runExternalTool({
    toolName: 'Ghostscript',
    executable,
    args,
    ...(signal === undefined ? {} : { signal }),
  });
}
