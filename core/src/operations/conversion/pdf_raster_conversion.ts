import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sourceFormatForPath } from '../../shared/source_format.js';
import { parsePdfPageSelection, type PdfPageSelectionParseResult } from '../../shared/pdf_page_selection.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { countPdfPages } from '../pdf/mupdf.js';
import {
  cleanupConversionArtifacts,
  type CleanupResult,
  type ConversionArtifactRoot,
} from '../lifecycle/cleanup_conversion_artifacts.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { CommittedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import { createPdfRenderBackend } from './tools/pdf_render_tools.js';
import {
  executeRasterConversion,
  rasterFormatSpecs,
  type RasterInput,
  type RasterConversionTarget,
} from './raster_conversion.js';
import { planPdfPageJobs } from './plan_pdf_page_jobs.js';

const pdfRasterTargets = ['png', 'jpeg', 'webp'] as const satisfies readonly RasterConversionTarget[];
export type PdfRasterTarget = (typeof pdfRasterTargets)[number];

export type PdfRasterPageSelection = { kind: 'all' } | { kind: 'range'; value: string };

export interface PdfRasterSource {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  pageCount: number;
}

export interface PdfRasterConversionPlan {
  target: PdfRasterTarget;
  source: PdfRasterSource;
  outputTemplate: string;
  inputs: RasterInput[];
}

export interface PdfRasterConversionResult {
  outputs: CommittedConversionOutput[];
  cleanup: CleanupResult;
}

export function availablePdfRasterTargets(sourcePath: string): readonly PdfRasterTarget[] {
  return sourceFormatForPath(sourcePath) === 'pdf' ? pdfRasterTargets : [];
}

export async function inspectPdfRasterSource(options: {
  sourcePath: string;
  workspacePath?: string;
  signal?: AbortSignal;
}): Promise<PdfRasterSource> {
  const sourcePath = path.resolve(options.sourcePath);
  if (availablePdfRasterTargets(sourcePath).length === 0) {
    throw new Error(`The Terminal UI currently supports PDF input only: ${sourcePath}`);
  }

  const workspacePath = path.resolve(options.workspacePath ?? path.dirname(sourcePath));
  options.signal?.throwIfAborted();
  await assertExistingPathInWorkspace(sourcePath, workspacePath);
  options.signal?.throwIfAborted();
  const pageCount = await countPdfPages(await readFile(sourcePath));
  options.signal?.throwIfAborted();
  if (pageCount < 1) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }

  return {
    sourcePath,
    workspacePath,
    workspaceName: path.basename(workspacePath),
    pageCount,
  };
}

export function resolvePdfRasterPages(
  selection: PdfRasterPageSelection,
  pageCount: number,
): PdfPageSelectionParseResult {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    return pageSelectionFailure('outOfRange', String(pageCount));
  }

  if (selection.kind === 'all') {
    return { ok: true, pages: Array.from({ length: pageCount }, (_value, index) => index + 1) };
  }

  const result = parsePdfPageSelection(selection.value, pageCount);
  return result.ok ? { ok: true, pages: [...new Set(result.pages)] } : result;
}

export function planPdfRasterConversion(options: {
  source: PdfRasterSource;
  target: PdfRasterTarget;
  selection: PdfRasterPageSelection;
  outputTemplate: string;
}): PdfRasterConversionPlan {
  const pages = resolvePdfRasterPages(options.selection, options.source.pageCount);
  if (!pages.ok) {
    throw new Error(formatPdfPageSelectionError(pages, options.source.pageCount));
  }

  const spec = rasterFormatSpecs[options.target];
  return {
    target: options.target,
    source: options.source,
    outputTemplate: options.outputTemplate,
    inputs: planPdfPageJobs(
      options.source,
      options.source.pageCount,
      options.outputTemplate,
      spec.extensions,
      pages.pages,
    ),
  };
}

export async function runPdfRasterConversion(options: {
  plan: PdfRasterConversionPlan;
  runtime: ConversionExecutionContext;
  maxInputPixels: number;
  webpEffort?: number;
}): Promise<PdfRasterConversionResult> {
  const spec = rasterFormatSpecs[options.plan.target];
  const outputs = await executeRasterConversion({
    inputs: options.plan.inputs,
    runtime: options.runtime,
    pdfRenderTools: createPdfRenderBackend(),
    maxInputPixels: options.maxInputPixels,
    spec,
    ...(options.plan.target === 'webp' && options.webpEffort !== undefined
      ? { outputOptions: { effort: options.webpEffort } }
      : {}),
  });

  // The VS Code frontend retains these roots for Undo. The TUI deliberately
  // has no Undo history, so release both normal staging files and overwrite
  // backups after the committed outputs have been reported as successful.
  const cleanup = await cleanupConversionArtifacts(artifactsForOutputs(outputs), options.runtime.outputChannel);
  return { outputs, cleanup };
}

function formatPdfPageSelectionError(
  failure: Extract<PdfPageSelectionParseResult, { ok: false }>,
  pageCount: number,
): string {
  switch (failure.kind) {
    case 'required': {
      return 'At least one PDF page must be selected.';
    }
    case 'wholeNumber': {
      return `PDF pages must be whole numbers: ${failure.token}`;
    }
    case 'descending': {
      return `PDF page ranges must be ascending: ${failure.token}`;
    }
    case 'outOfRange': {
      return `PDF pages must be between 1 and ${pageCount}: ${failure.token}`;
    }
    case 'malformed': {
      return `Invalid PDF page range: ${failure.token}`;
    }
    default: {
      return `Invalid PDF page selection: ${failure.token}`;
    }
  }
}

function pageSelectionFailure(
  kind: Extract<PdfPageSelectionParseResult, { ok: false }>['kind'],
  token: string,
): Extract<PdfPageSelectionParseResult, { ok: false }> {
  return { ok: false, kind, token };
}

function artifactsForOutputs(outputs: readonly CommittedConversionOutput[]): ConversionArtifactRoot[] {
  return outputs.flatMap((output) =>
    output.stagingRootPath === undefined || output.stagingRootPath === ''
      ? []
      : [
          {
            rootPath: output.stagingRootPath,
            workspacePath: output.stagingWorkspacePath ?? output.workspacePath,
          },
        ],
  );
}
