import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  loadMupdf,
  normalizeRotation,
  openPdfDocument,
  savePdfDocument,
  type MupdfPdfPage,
} from '@graphics-workbench/core/operations/pdf/mupdf.js';

import {
  assertExistingPathInWorkspace,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type {
  CommittedConversionOutput,
  PreparedConversionOutput,
} from '@graphics-workbench/core/operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '@graphics-workbench/core/operations/lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '@graphics-workbench/core/operations/lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '@graphics-workbench/core/operations/lifecycle/run_id.js';
import { copyFileWithAbort } from '@graphics-workbench/core/operations/lifecycle/copy_file_with_abort.js';

export const PDF_ROTATION_ANGLES = [90, 180, 270] as const;
export type PdfRotationAngle = (typeof PDF_ROTATION_ANGLES)[number];

export interface RotatePdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  angle: PdfRotationAngle;
  /** 0-based page indices to rotate. When omitted, every page is rotated. */
  pageIndices?: number[];
}

export interface RotatePdfOptions {
  inputs: RotatePdfInput[];
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function rotatePdfFiles(options: RotatePdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateConversions(options.inputs);
  await validatePdfPathInputs(options.inputs, 'rotate-pdf');
  runtime?.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'rotate-pdf',
    runId: options.runId,
    ...(runtime !== undefined && { runtime }),
    stage: async (input, index, currentRunId, batchRuntime) =>
      rotatePdf({ input, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

async function rotatePdf(params: {
  input: RotatePdfInput;
  index: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput> {
  const { input, index, runId, signal } = params;
  signal.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'rotate-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const copiedSourcePath = path.join(workDirectory, path.basename(input.sourcePath));
  const stagedOutputPath = path.join(workDirectory, 'result.pdf');

  await assertExistingPathInWorkspace(input.sourcePath, input.workspacePath);
  await assertWritablePathInWorkspace(workDirectory, input.workspacePath);
  signal.throwIfAborted();
  await mkdir(workDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();
  await copyFileWithAbort(input.sourcePath, copiedSourcePath, undefined, signal);

  await assertExistingPathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();
  const mupdf = await loadMupdf();
  const sourceDocument = await openPdfDocument(await readFile(copiedSourcePath));
  try {
    signal.throwIfAborted();
    const pageCount = sourceDocument.countPages();

    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${input.sourcePath}`);
    }

    const pageIndices = input.pageIndices ?? Array.from({ length: pageCount }, (_, pageIndex) => pageIndex);
    validatePageIndices(pageIndices, pageCount, input.sourcePath);

    const outputDocument = new mupdf.PDFDocument();
    const rotateSet = new Set(pageIndices);
    try {
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        signal.throwIfAborted();
        outputDocument.graftPage(outputDocument.countPages(), sourceDocument, pageIndex);
        if (rotateSet.has(pageIndex)) {
          // graftPageは既存のRotate値を引き継ぐため、現在の回転に加算する。
          // 置換すると「90°回転済みページを90°回転」が無変化になる。
          const page = outputDocument.loadPage(pageIndex);
          // oxlint-disable-next-line max-depth -- Each resource needs a local try/finally for deterministic disposal.
          try {
            const currentRotation = readPageRotation(page);
            page.getObject().put('Rotate', normalizeRotation(currentRotation + input.angle));
          } finally {
            page.destroy();
          }
        }
      }
      await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
      signal.throwIfAborted();
      await writeFile(stagedOutputPath, savePdfDocument(outputDocument));
      signal.throwIfAborted();

      return {
        stagedOutputPath,
        outputPath: input.outputPath,
        workspacePath: input.workspacePath,
        stagingRootPath,
      };
    } finally {
      outputDocument.destroy();
    }
  } finally {
    sourceDocument.destroy();
  }
}

function validateConversions(inputs: RotatePdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be rotated: ${input.sourcePath}`);
    }

    if (!PDF_ROTATION_ANGLES.includes(input.angle)) {
      throw new Error(`Unsupported rotation angle: ${input.angle}`);
    }
  }
}

function validatePageIndices(pageIndices: number[], pageCount: number, sourcePath: string): void {
  for (const pageIndex of pageIndices) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
      throw new Error(`Page index ${pageIndex} is out of range for ${sourcePath}`);
    }
  }
}

function readPageRotation(page: MupdfPdfPage): number {
  const rotate = page.getObject().getInheritable('Rotate');
  return rotate.isNumber() ? rotate.asNumber() : 0;
}
