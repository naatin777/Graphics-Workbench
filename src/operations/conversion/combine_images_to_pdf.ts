import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { isRasterImagePath, sourceFormatForPath } from '../../application/policy/source_format.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

import { cleanupConversionArtifacts, type ConversionArtifactRoot } from '../lifecycle/cleanup_conversion_artifacts.js';
import {
  commitStagedOutputs,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import { writeSourceAsPdf, type WriteSourceAsPdfOptions } from './convert_to_pdf.js';
import { getDefaultConfiguration } from '../../generated/extension_manifest.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { destroyRasterInput, openRasterInput } from './raster_input.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import type { RsvgToolScratchOptions, RunRsvgConvert } from '../external_tools/run_rsvg_convert_with_ascii_scratch.js';
import type { SvgToPdfBackend } from './tools/index.js';

interface CombineImagesJob {
  sourcePath: string;
}

export interface CombineImagesToPdfOptions {
  jobs: CombineImagesJob[];
  outputPath: string;
  workspacePath: string;
  runtime?: ConversionExecutionContext;
  maxInputPixels?: number;
  runId?: string;
  tools?: {
    svgToPdfTools?: SvgToPdfBackend;
    rsvgConvertPath?: string;
    runRsvgConvert?: RunRsvgConvert;
    ghostscriptPath?: string;
  };
  platform?: NodeJS.Platform;
  scratchBaseCandidates?: readonly string[];
}

export async function combineImagesToPdf(options: CombineImagesToPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  const configuredMaxInputPixels = options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels();
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);

  await Promise.all([
    ...options.jobs.map(async (job) => assertExistingPathInWorkspace(job.sourcePath, options.workspacePath)),
    assertWritablePathInWorkspace(options.outputPath, options.workspacePath),
    assertWritablePathInWorkspace(
      path.join(options.workspacePath, '.graphics-workbench', 'combine-images'),
      options.workspacePath,
    ),
  ]);
  runtime?.signal?.throwIfAborted();

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();
  const stagingRootPath = createStagingRoot(options.workspacePath, 'combine-images', runId);
  const artifacts: ConversionArtifactRoot[] = [{ rootPath: stagingRootPath, workspacePath: options.workspacePath }];

  try {
    await mkdir(stagingRootPath, { recursive: true });
    const pdfPaths = await createPdfPaths(options, configuredMaxInputPixels, stagingRootPath);
    const mergedDocument = await mergePdfPaths(pdfPaths, runtime);

    runtime?.signal?.throwIfAborted();
    const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
    await writeFile(stagedOutputPath, await mergedDocument.save());
    runtime?.signal?.throwIfAborted();

    const commitOptions = commitOptionsForRuntime(runtime);
    return await commitStagedOutputs(
      [{ stagedOutputPath, outputPath: options.outputPath, workspacePath: options.workspacePath, stagingRootPath }],
      commitOptions,
    );
  } catch (error) {
    await cleanupConversionArtifacts(artifacts, runtime?.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function createPdfPaths(
  options: CombineImagesToPdfOptions,
  maxInputPixels: number,
  stagingRootPath: string,
): Promise<string[]> {
  const pdfPaths: string[] = [];
  for (const [index, job] of options.jobs.entries()) {
    options.runtime?.signal?.throwIfAborted();
    const pageCount = await sourcePageCount(job.sourcePath, maxInputPixels);
    for (let page = 1; page <= pageCount; page += 1) {
      options.runtime?.signal?.throwIfAborted();
      const pdfPath = path.join(stagingRootPath, `page-${index + 1}-${page}.pdf`);
      const writeOptions: WriteSourceAsPdfOptions = {
        sourcePath: job.sourcePath,
        outputPath: pdfPath,
        workspacePath: options.workspacePath,
        maxInputPixels,
        tools: { svgToPdfTools: svgToPdfOptions(options) },
        scratchOptions: scratchOptions(options),
        ...(pageCount > 1 ? { page } : {}),
      };
      if (options.runtime?.signal !== undefined) {
        writeOptions.signal = options.runtime.signal;
      }
      if (options.tools?.ghostscriptPath !== undefined) {
        writeOptions.tools = { ...writeOptions.tools, ghostscriptPath: options.tools.ghostscriptPath };
      }
      await writeSourceAsPdf(writeOptions);
      pdfPaths.push(pdfPath);
    }
    options.runtime?.reportProgress?.(index + 1, options.jobs.length);
  }
  return pdfPaths;
}

async function mergePdfPaths(
  pdfPaths: string[],
  runtime: ConversionExecutionContext | undefined,
): Promise<PDFDocument> {
  const mergedDocument = await PDFDocument.create();
  for (const pdfPath of pdfPaths) {
    runtime?.signal?.throwIfAborted();
    const sourceDocument = await PDFDocument.load(await readFile(pdfPath));
    const pages = await mergedDocument.copyPages(sourceDocument, sourceDocument.getPageIndices());
    for (const page of pages) {
      mergedDocument.addPage(page);
    }
  }
  return mergedDocument;
}

function commitOptionsForRuntime(runtime: ConversionExecutionContext | undefined): CommitConversionOutputsOptions {
  const commitOptions: CommitConversionOutputsOptions = {
    operationName: 'combine-images-to-pdf',
  };
  if (runtime?.signal !== undefined) {
    commitOptions.signal = runtime.signal;
  }
  if (runtime?.resolveConflicts !== undefined) {
    commitOptions.resolveConflicts = runtime.resolveConflicts;
  }
  if (runtime?.outputChannel !== undefined) {
    commitOptions.outputChannel = runtime.outputChannel;
  }
  return commitOptions;
}

async function sourcePageCount(sourcePath: string, maxInputPixels: number): Promise<number> {
  if (!isRasterImagePath(sourcePath)) {
    return 1;
  }

  const image = openRasterInput(sourcePath, maxInputPixels, undefined, true);
  try {
    const metadata = await image.metadata();
    return Math.max(1, metadata.pages ?? 1);
  } finally {
    await destroyRasterInput(image);
  }
}

function validateJobs(jobs: CombineImagesJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No images were selected.');
  }

  for (const job of jobs) {
    const format = sourceFormatForPath(job.sourcePath);
    if (!isRasterImagePath(job.sourcePath) && format !== 'svg' && format !== 'eps') {
      throw new Error(`Unsupported image input: ${job.sourcePath}`);
    }
  }
}

function svgToPdfOptions(options: CombineImagesToPdfOptions): SvgToPdfBackend {
  if (options.tools?.svgToPdfTools !== undefined) {
    if (options.tools.runRsvgConvert === undefined) {
      return options.tools.svgToPdfTools;
    }

    return { ...options.tools.svgToPdfTools, runRsvgConvert: options.tools.runRsvgConvert };
  }

  return {
    engine: 'rsvg-convert',
    rsvgConvertPath: options.tools?.rsvgConvertPath ?? 'rsvg-convert',
    chromePath: '',
    ...(options.tools?.runRsvgConvert !== undefined && { runRsvgConvert: options.tools.runRsvgConvert }),
  };
}

function scratchOptions(options: CombineImagesToPdfOptions): RsvgToolScratchOptions {
  const result: RsvgToolScratchOptions = {};
  if (options.platform !== undefined) {
    result.platform = options.platform;
  }
  if (options.scratchBaseCandidates !== undefined) {
    result.scratchBaseCandidates = options.scratchBaseCandidates;
  }
  if (options.runtime?.outputChannel !== undefined) {
    result.outputChannel = options.runtime.outputChannel;
  }
  return result;
}
