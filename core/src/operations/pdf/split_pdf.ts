import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadMupdf, openPdfDocument, savePdfDocument } from './mupdf.js';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfPathInputs } from './pdf_path_validation.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';

export interface SplitPdfInput {
  sourcePath: string;
  workspacePath: string;
  outputPathForPage: (page: number) => string;
}

interface SplitPdfGroupInput {
  sourcePath: string;
  workspacePath: string;
  pageGroups: number[][];
  outputPathForGroup: (groupIndex: number, pages: readonly number[]) => string;
}

export interface SplitPdfOptions {
  inputs: SplitPdfInput[];
  runtime: ConversionExecutionContext;
  runId?: string;
}

export interface SplitPdfByPageGroupsOptions {
  inputs: SplitPdfGroupInput[];
  runtime: ConversionExecutionContext;
  runId?: string;
}

export async function splitPdfAllPages(options: SplitPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime.signal?.throwIfAborted();
  validateInputs(options.inputs);
  await validatePdfPathInputs(options.inputs, 'split-pdf');
  runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'split-pdf',
    runId: options.runId,
    runtime,
    stage: async (input, index, currentRunId, batchRuntime) =>
      splitPdf({ input, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

export async function splitPdfByPageGroups(options: SplitPdfByPageGroupsOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime.signal?.throwIfAborted();
  validatePageGroupInputs(options.inputs);
  await validatePdfPathInputs(options.inputs, 'split-pdf');
  runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'split-pdf',
    runId: options.runId,
    runtime,
    stage: async (input, index, currentRunId, batchRuntime) =>
      splitPdfPageGroups({ input, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

async function splitPdf(params: {
  input: SplitPdfInput;
  index: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput[]> {
  const { input, index, runId, signal } = params;
  signal.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'split-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const pagesDirectory = path.join(workDirectory, 'pages');
  const copiedSourcePath = path.join(workDirectory, path.basename(input.sourcePath));

  await assertExistingPathInWorkspace(input.sourcePath, input.workspacePath);
  await assertWritablePathInWorkspace(pagesDirectory, input.workspacePath);
  signal.throwIfAborted();
  await mkdir(pagesDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();
  await copyFileWithAbort(input.sourcePath, copiedSourcePath, undefined, signal);

  await assertExistingPathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();
  const mupdf = await loadMupdf();
  const sourceDocument = await openPdfDocument(await readFile(copiedSourcePath));
  signal.throwIfAborted();

  try {
    const pageCount = sourceDocument.countPages();

    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${input.sourcePath}`);
    }

    const stagedPages: PreparedConversionOutput[] = [];

    // oxlint-disable-next-line no-unreachable-loop -- each page is staged independently.
    for (let page = 1; page <= pageCount; page++) {
      signal.throwIfAborted();
      const pageDocument = new mupdf.PDFDocument();
      try {
        pageDocument.graftPage(0, sourceDocument, page - 1);

        const stagedOutputPath = path.join(pagesDirectory, `${page}.pdf`);
        await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
        signal.throwIfAborted();
        await writeFile(stagedOutputPath, savePdfDocument(pageDocument));
        signal.throwIfAborted();

        stagedPages.push({
          stagedOutputPath,
          outputPath: input.outputPathForPage(page),
          workspacePath: input.workspacePath,
          stagingRootPath,
        });
      } finally {
        pageDocument.destroy();
      }
    }

    return stagedPages;
  } finally {
    sourceDocument.destroy();
  }
}

async function splitPdfPageGroups(params: {
  input: SplitPdfGroupInput;
  index: number;
  runId: string;
  signal: AbortSignal;
}): Promise<PreparedConversionOutput[]> {
  const { input, index, runId, signal } = params;
  const { pageGroups, outputPathForGroup } = input;

  signal.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`;
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'split-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const groupsDirectory = path.join(workDirectory, 'groups');
  const copiedSourcePath = path.join(workDirectory, path.basename(input.sourcePath));

  await assertExistingPathInWorkspace(input.sourcePath, input.workspacePath);
  await assertWritablePathInWorkspace(groupsDirectory, input.workspacePath);
  signal.throwIfAborted();
  await mkdir(groupsDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();
  await copyFileWithAbort(input.sourcePath, copiedSourcePath, undefined, signal);

  await assertExistingPathInWorkspace(copiedSourcePath, input.workspacePath);
  signal.throwIfAborted();
  const mupdf = await loadMupdf();
  const sourceDocument = await openPdfDocument(await readFile(copiedSourcePath));
  signal.throwIfAborted();

  try {
    const pageCount = sourceDocument.countPages();

    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${input.sourcePath}`);
    }

    validatePageGroups(pageGroups, pageCount, input.sourcePath);

    const stagedGroups: PreparedConversionOutput[] = [];

    // oxlint-disable-next-line no-unreachable-loop -- each group is staged independently.
    for (const [groupIndex, pages] of pageGroups.entries()) {
      signal.throwIfAborted();
      const groupDocument = new mupdf.PDFDocument();
      try {
        for (const page of pages) {
          groupDocument.graftPage(groupDocument.countPages(), sourceDocument, page - 1);
        }

        const stagedOutputPath = path.join(groupsDirectory, `${groupIndex + 1}.pdf`);
        await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
        signal.throwIfAborted();
        await writeFile(stagedOutputPath, savePdfDocument(groupDocument));
        signal.throwIfAborted();

        stagedGroups.push({
          stagedOutputPath,
          outputPath: outputPathForGroup(groupIndex, pages),
          workspacePath: input.workspacePath,
          stagingRootPath,
        });
      } finally {
        groupDocument.destroy();
      }
    }

    return stagedGroups;
  } finally {
    sourceDocument.destroy();
  }
}

function validateInputs(inputs: SplitPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be split: ${input.sourcePath}`);
    }
  }
}

function validatePageGroupInputs(inputs: SplitPdfGroupInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const input of inputs) {
    if (path.extname(input.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be split: ${input.sourcePath}`);
    }

    if (input.pageGroups.length === 0) {
      throw new Error(`No page groups were supplied: ${input.sourcePath}`);
    }

    for (const pages of input.pageGroups) {
      if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error(`Page groups cannot be empty: ${input.sourcePath}`);
      }
    }
  }
}

function validatePageGroups(pageGroups: number[][], pageCount: number, sourcePath: string): void {
  for (const [groupIndex, pages] of pageGroups.entries()) {
    for (const page of pages) {
      if (!Number.isInteger(page) || page < 1 || page > pageCount) {
        throw new Error(`Page ${page} in group ${groupIndex} is out of range for ${sourcePath}`);
      }
    }
  }
}
