import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { convertSplitPng, convertSplitJpeg, convertSplitWebp } from '@graphics-workbench/core/conversion';
import { countPdfPages } from '@graphics-workbench/core/pdf';
import { parsePdfPageSelection, sourceFormatForPath } from '@graphics-workbench/core/formats';
import {
  cleanupConversionArtifacts,
  type CleanupResult,
  type ConversionExecutionContext,
} from '@graphics-workbench/core/runtime';

export const terminalUiRasterTargets = ['png', 'jpeg', 'webp'] as const satisfies readonly ('png' | 'jpeg' | 'webp')[];
export type TerminalUiRasterTarget = (typeof terminalUiRasterTargets)[number];

export interface TerminalUiPdfSource {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  pageCount: number;
}

export type TerminalUiPageSelection = { kind: 'all' } | { kind: 'range'; value: string };

export interface TerminalUiPdfRasterPlan {
  target: TerminalUiRasterTarget;
  source: TerminalUiPdfSource;
  outputTemplate: string;
  pages: number[];
  inputCount: number;
}

export interface TerminalUiConversionResult {
  outputs: { outputPath: string }[];
  cleanup: CleanupResult;
}

export function availableTerminalUiRasterTargets(sourcePath: string): readonly TerminalUiRasterTarget[] {
  return sourceFormatForPath(sourcePath) === 'pdf' ? terminalUiRasterTargets : [];
}

/** Inspects a PDF and resolves its page count for the Terminal UI. */
export async function inspectTerminalUiSource(options: {
  sourcePath: string;
  signal?: AbortSignal;
}): Promise<TerminalUiPdfSource> {
  const sourcePath = path.resolve(options.sourcePath);
  if (sourceFormatForPath(sourcePath) !== 'pdf') {
    throw new Error(`PDF input required: ${sourcePath}`);
  }
  options.signal?.throwIfAborted();
  const pageCount = await countPdfPages(await readFile(sourcePath));
  options.signal?.throwIfAborted();
  if (pageCount < 1) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }
  return {
    sourcePath,
    workspacePath: path.dirname(sourcePath),
    workspaceName: path.basename(path.dirname(sourcePath)),
    pageCount,
  };
}

/** Resolves a page selection against a page count, returning the 1-based pages. */
export function resolveTerminalUiPages(
  selection: TerminalUiPageSelection,
  pageCount: number,
): { ok: true; pages: number[] } | { ok: false; error: string } {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: `Page count is invalid: ${pageCount}` };
  }
  if (selection.kind === 'all') {
    return { ok: true, pages: Array.from({ length: pageCount }, (_v, i) => i + 1) };
  }
  const parsed = parsePdfPageSelection(selection.value, pageCount);
  if (!parsed.ok) {
    return { ok: false, error: `Invalid PDF page range: ${parsed.token}` };
  }
  return { ok: true, pages: [...new Set(parsed.pages)] };
}

const SPLIT_CONVERTERS = {
  png: convertSplitPng,
  jpeg: convertSplitJpeg,
  webp: convertSplitWebp,
} as const;

export async function runTerminalPdfRasterConversion(options: {
  plan: TerminalUiPdfRasterPlan;
  runtime: ConversionExecutionContext;
  maxInputPixels: number;
  webpEffort?: number;
}): Promise<TerminalUiConversionResult> {
  const { plan } = options;
  const result = await SPLIT_CONVERTERS[plan.target](
    [
      {
        sourcePath: plan.source.sourcePath,
        workspacePath: plan.source.workspacePath,
        workspaceName: plan.source.workspaceName,
        pages: plan.pages,
      },
    ],
    plan.outputTemplate,
    {
      maxInputPixels: options.maxInputPixels,
      maxAnimationPixels: options.maxInputPixels,
      platform: process.platform,
      svgToPdf: {
        engine: 'rsvg-convert',
        rsvgConvertPath: 'rsvg-convert',
        chromePath: '',
      },
      drawioPath: '',
      avifEffort: 4,
      webpEffort: options.webpEffort ?? 4,
    },
    options.runtime,
  );
  if (result.isErr()) {
    throw result.error;
  }
  const outputs = result.value.map((output) => ({ outputPath: output.outputPath }));
  const cleanup = await cleanupConversionArtifacts(
    result.value.map((output) => ({ rootPath: output.outputPath, workspacePath: output.workspacePath })),
    options.runtime.outputChannel,
  );
  return { outputs, cleanup };
}
