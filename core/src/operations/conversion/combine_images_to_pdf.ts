import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isRasterFormat, isRasterImagePath, sourceFormatForPath } from '../../shared/source_format.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

import { cleanupConversionArtifacts, type ConversionArtifactRoot } from '../lifecycle/cleanup_conversion_artifacts.js';
import {
  commitStagedOutputs,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import { writeSourceAsPdf, type WriteSourceAsPdfOptions } from './convert_to_pdf.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { readRasterAnimationMetadata } from './raster_input.js';
import { createRunId, stagingRootPathFor } from '../lifecycle/run_id.js';
import type { RsvgToolScratchOptions } from '../external_tools/run_rsvg_convert_with_ascii_scratch.js';
import type { SvgToPdfBackend } from './tools/svg_to_pdf_tools.js';
import { loadMupdf, openPdfDocument, savePdfDocument } from '../pdf/mupdf.js';

interface CombineImageInput {
  sourcePath: string;
}

export interface CombineImagesToPdfOptions {
  inputs: CombineImageInput[];
  outputPath: string;
  workspacePath: string;
  runtime: ConversionExecutionContext;
  maxInputPixels: number;
  runId?: string;
  tools?: {
    svgToPdfTools?: SvgToPdfBackend;
  };
  platform?: NodeJS.Platform;
  scratchBaseCandidates?: readonly string[];
}

export async function combineImagesToPdf(options: CombineImagesToPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime.signal?.throwIfAborted();
  validateInputs(options.inputs);

  await Promise.all([
    ...options.inputs.map(async (input) => assertExistingPathInWorkspace(input.sourcePath, options.workspacePath)),
    assertWritablePathInWorkspace(options.outputPath, options.workspacePath),
    assertWritablePathInWorkspace(
      path.join(options.workspacePath, '.graphics-workbench', 'combine-images'),
      options.workspacePath,
    ),
  ]);
  runtime.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();
  const stagingRootPath = stagingRootPathFor(options.workspacePath, 'combine-images', runId);
  const artifacts: ConversionArtifactRoot[] = [{ rootPath: stagingRootPath, workspacePath: options.workspacePath }];

  try {
    await mkdir(stagingRootPath, { recursive: true });
    const pdfPaths = await createPdfPaths(options, options.maxInputPixels, stagingRootPath);
    const mergedBytes = await mergePdfPaths(pdfPaths, runtime);

    runtime.signal?.throwIfAborted();
    const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
    await writeFile(stagedOutputPath, mergedBytes);
    runtime.signal?.throwIfAborted();

    const commitOptions = buildCommitOptions(runtime);
    return await commitStagedOutputs(
      [{ stagedOutputPath, outputPath: options.outputPath, workspacePath: options.workspacePath, stagingRootPath }],
      commitOptions,
    );
  } catch (error) {
    await cleanupConversionArtifacts(artifacts, runtime.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function createPdfPaths(
  options: CombineImagesToPdfOptions,
  maxInputPixels: number,
  stagingRootPath: string,
): Promise<string[]> {
  const pdfPaths: string[] = [];
  for (const [index, input] of options.inputs.entries()) {
    options.runtime.signal?.throwIfAborted();
    const pageCount = await sourcePageCount(input.sourcePath, maxInputPixels);
    for (let page = 1; page <= pageCount; page += 1) {
      options.runtime.signal?.throwIfAborted();
      const pdfPath = path.join(stagingRootPath, `page-${index + 1}-${page}.pdf`);
      const svgToPdfTools = svgToPdfOptions(options);
      const writeOptions: WriteSourceAsPdfOptions = {
        sourcePath: input.sourcePath,
        outputPath: pdfPath,
        workspacePath: options.workspacePath,
        maxInputPixels,
        signal: options.runtime.signal ?? new AbortController().signal,
        scratchOptions: scratchOptions(options),
        ...(pageCount > 1 ? { page } : {}),
        ...(svgToPdfTools !== undefined ? { tools: { svgToPdfTools } } : {}),
      };
      await writeSourceAsPdf(writeOptions);
      pdfPaths.push(pdfPath);
    }
    options.runtime.reportProgress?.(index + 1, options.inputs.length);
  }
  return pdfPaths;
}

async function mergePdfPaths(pdfPaths: string[], runtime: ConversionExecutionContext): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const mergedDocument = new mupdf.PDFDocument();
  try {
    // oxlint-disable-next-line no-unreachable-loop -- Merge every converted input document.
    for (const pdfPath of pdfPaths) {
      runtime.signal?.throwIfAborted();
      const sourceBytes = await readFile(pdfPath);
      const sourceDocument = await openPdfDocument(sourceBytes);
      try {
        const pageCount = sourceDocument.countPages();
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          runtime.signal?.throwIfAborted();
          mergedDocument.graftPage(mergedDocument.countPages(), sourceDocument, pageIndex);
        }
      } finally {
        sourceDocument.destroy();
      }
    }
    return savePdfDocument(mergedDocument);
  } finally {
    mergedDocument.destroy();
  }
}

function buildCommitOptions(runtime: ConversionExecutionContext): CommitConversionOutputsOptions {
  const commitOptions: CommitConversionOutputsOptions = {
    operationName: 'combine-images-to-pdf',
  };
  if (runtime.signal !== undefined) {
    commitOptions.signal = runtime.signal;
  }
  if (runtime.resolveConflicts !== undefined) {
    commitOptions.resolveConflicts = runtime.resolveConflicts;
  }
  if (runtime.outputChannel !== undefined) {
    commitOptions.outputChannel = runtime.outputChannel;
  }
  return commitOptions;
}

async function sourcePageCount(sourcePath: string, maxInputPixels: number): Promise<number> {
  if (!isRasterImagePath(sourcePath)) {
    return 1;
  }

  const animation = await readRasterAnimationMetadata(sourcePath, maxInputPixels);
  return animation?.pages ?? 1;
}

function validateInputs(inputs: CombineImageInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No images were selected.');
  }

  for (const input of inputs) {
    const format = sourceFormatForPath(input.sourcePath);
    if (!isRasterFormat(format) && format !== 'svg') {
      throw new Error(`Unsupported image input: ${input.sourcePath}`);
    }
  }
}

function svgToPdfOptions(options: CombineImagesToPdfOptions): SvgToPdfBackend | undefined {
  return options.tools?.svgToPdfTools;
}

function scratchOptions(options: CombineImagesToPdfOptions): RsvgToolScratchOptions {
  const result: RsvgToolScratchOptions = {};
  if (options.platform !== undefined) {
    result.platform = options.platform;
  }
  if (options.scratchBaseCandidates !== undefined) {
    result.scratchBaseCandidates = options.scratchBaseCandidates;
  }
  if (options.runtime.outputChannel !== undefined) {
    result.outputChannel = options.runtime.outputChannel;
  }
  return result;
}
