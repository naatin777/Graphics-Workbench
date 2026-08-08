import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadMupdf, openPdfDocument, savePdfDocument } from './mupdf.js';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { sanitizePdfPathSegment, validatePdfJobPaths } from './pdf_job_paths.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';

export interface SplitPdfJob {
  sourcePath: string;
  workspacePath: string;
  outputPathForPage: (page: number) => string;
}

interface SplitPdfPageGroupsJob {
  sourcePath: string;
  workspacePath: string;
  pageGroups?: number[][];
  outputPathForGroup?: (groupIndex: number, pages: readonly number[]) => string;
}

export interface SplitPdfOptions {
  jobs: SplitPdfJob[];
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export interface SplitPdfByPageGroupsOptions {
  jobs: SplitPdfPageGroupsJob[];
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function splitPdfAllPages(options: SplitPdfOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs);
  await validatePdfJobPaths(options.jobs, 'split-pdf');
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'split-pdf',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      splitPdf({ job, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

export async function splitPdfByPageGroups(options: SplitPdfByPageGroupsOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  runtime?.signal?.throwIfAborted();
  validatePageGroupJobs(options.jobs);
  await validatePdfJobPaths(options.jobs, 'split-pdf');
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'split-pdf',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      splitPdfPageGroups({ job, index, runId: currentRunId, signal: batchRuntime.signal }),
  });
}

async function splitPdf(params: {
  job: SplitPdfJob;
  index: number;
  runId: string;
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput[]> {
  const { job, index, runId, signal } = params;
  signal?.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = createStagingRoot(job.workspacePath, 'split-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const pagesDirectory = path.join(workDirectory, 'pages');
  const copiedSourcePath = path.join(workDirectory, path.basename(job.sourcePath));

  await assertExistingPathInWorkspace(job.sourcePath, job.workspacePath);
  await assertWritablePathInWorkspace(pagesDirectory, job.workspacePath);
  signal?.throwIfAborted();
  await mkdir(pagesDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  await copyFileWithAbort(job.sourcePath, copiedSourcePath, undefined, signal);

  await assertExistingPathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  const mupdf = await loadMupdf();
  const sourceDocument = await openPdfDocument(await readFile(copiedSourcePath));
  signal?.throwIfAborted();

  try {
    const pageCount = sourceDocument.countPages();

    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${job.sourcePath}`);
    }

    const stagedPages: PreparedConversionOutput[] = [];

    for (let page = 1; page <= pageCount; page++) {
      signal?.throwIfAborted();
      const pageDocument = new mupdf.PDFDocument();
      pageDocument.graftPage(0, sourceDocument, page - 1);

      const stagedOutputPath = path.join(pagesDirectory, `${page}.pdf`);
      await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
      signal?.throwIfAborted();
      await writeFile(stagedOutputPath, savePdfDocument(pageDocument));
      signal?.throwIfAborted();

      stagedPages.push({
        stagedOutputPath,
        outputPath: job.outputPathForPage(page),
        workspacePath: job.workspacePath,
        stagingRootPath,
      });
    }

    return stagedPages;
  } finally {
    sourceDocument.destroy();
  }
}

async function splitPdfPageGroups(params: {
  job: SplitPdfPageGroupsJob;
  index: number;
  runId: string;
  signal: AbortSignal | undefined;
}): Promise<PreparedConversionOutput[]> {
  const { job, index, runId, signal } = params;
  const { pageGroups } = job;
  const { outputPathForGroup } = job;

  if (!pageGroups || !outputPathForGroup) {
    throw new Error('Page groups and outputPathForGroup are required.');
  }

  signal?.throwIfAborted();

  const itemName = `${index + 1}-${sanitizePdfPathSegment(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`;
  const stagingRootPath = createStagingRoot(job.workspacePath, 'split-pdf', runId);
  const workDirectory = path.join(stagingRootPath, itemName);
  const groupsDirectory = path.join(workDirectory, 'groups');
  const copiedSourcePath = path.join(workDirectory, path.basename(job.sourcePath));

  await assertExistingPathInWorkspace(job.sourcePath, job.workspacePath);
  await assertWritablePathInWorkspace(groupsDirectory, job.workspacePath);
  signal?.throwIfAborted();
  await mkdir(groupsDirectory, { recursive: true });
  await assertWritablePathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  await copyFileWithAbort(job.sourcePath, copiedSourcePath, undefined, signal);

  await assertExistingPathInWorkspace(copiedSourcePath, job.workspacePath);
  signal?.throwIfAborted();
  const mupdf = await loadMupdf();
  const sourceDocument = await openPdfDocument(await readFile(copiedSourcePath));
  signal?.throwIfAborted();

  try {
    const pageCount = sourceDocument.countPages();

    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${job.sourcePath}`);
    }

    validatePageGroups(pageGroups, pageCount, job.sourcePath);

    const stagedGroups: PreparedConversionOutput[] = [];

    for (const [groupIndex, pages] of pageGroups.entries()) {
      signal?.throwIfAborted();
      const groupDocument = new mupdf.PDFDocument();
      for (const page of pages) {
        groupDocument.graftPage(groupDocument.countPages(), sourceDocument, page - 1);
      }

      const stagedOutputPath = path.join(groupsDirectory, `${groupIndex + 1}.pdf`);
      await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
      signal?.throwIfAborted();
      await writeFile(stagedOutputPath, savePdfDocument(groupDocument));
      signal?.throwIfAborted();

      stagedGroups.push({
        stagedOutputPath,
        outputPath: outputPathForGroup(groupIndex, pages),
        workspacePath: job.workspacePath,
        stagingRootPath,
      });
    }

    return stagedGroups;
  } finally {
    sourceDocument.destroy();
  }
}

function validateJobs(jobs: SplitPdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be split: ${job.sourcePath}`);
    }
  }
}

function validatePageGroupJobs(jobs: SplitPdfPageGroupsJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No PDF files were selected.');
  }

  for (const job of jobs) {
    if (path.extname(job.sourcePath).toLowerCase() !== '.pdf') {
      throw new Error(`Only PDF files can be split: ${job.sourcePath}`);
    }

    if (!job.pageGroups || job.pageGroups.length === 0) {
      throw new Error(`No page groups were supplied: ${job.sourcePath}`);
    }

    if (!job.outputPathForGroup) {
      throw new Error(`outputPathForGroup is required: ${job.sourcePath}`);
    }

    for (const pages of job.pageGroups) {
      if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error(`Page groups cannot be empty: ${job.sourcePath}`);
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
