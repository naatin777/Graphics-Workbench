import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadMupdf, openPdfDocument, savePdfDocument, type MupdfPdfDocumentInstance } from './mupdf.js';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

import { cleanupConversionArtifacts, type ConversionArtifactRoot } from '../lifecycle/cleanup_conversion_artifacts.js';
import {
  commitStagedOutputs,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';

import { createRunId, stagingRootPathFor } from '../lifecycle/run_id.js';

export interface MergePdfOptions {
  sourcePaths: string[];
  outputPath: string;
  workspacePath: string;
  runtime?: ConversionExecutionContext;
  runId?: string;
}

export async function mergePdf(options: MergePdfOptions): Promise<CommittedConversionOutput[]> {
  const { sourcePaths, outputPath, runtime } = options;

  runtime?.outputChannel?.appendLine(`[merge-pdf] input paths: ${sourcePaths.join(', ')}`);
  runtime?.outputChannel?.appendLine(`[merge-pdf] requested output: ${outputPath}`);

  if (sourcePaths.length < 2) {
    throw new Error('Select at least two PDF files.');
  }

  const prepared = await buildMergedDocument(options);
  return writeMergedPdf(options, prepared);
}

async function buildMergedDocument(options: MergePdfOptions): Promise<{
  mergedDocument: MupdfPdfDocumentInstance;
  stagingRootPath: string;
  stagedOutputPath: string;
}> {
  const { sourcePaths, outputPath, workspacePath, runtime } = options;
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();
  const stagingRootPath = stagingRootPathFor(workspacePath, 'merge-pdf', runId);
  const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
  await Promise.all([
    ...sourcePaths.map(async (sourcePath) => assertExistingPathInWorkspace(sourcePath, workspacePath)),
    assertWritablePathInWorkspace(outputPath, workspacePath),
    assertWritablePathInWorkspace(path.join(workspacePath, '.graphics-workbench', 'merge-pdf'), workspacePath),
    assertWritablePathInWorkspace(stagingRootPath, workspacePath),
    assertWritablePathInWorkspace(stagedOutputPath, workspacePath),
  ]);
  runtime?.signal?.throwIfAborted();

  const mupdf = await loadMupdf();
  const mergedDocument = new mupdf.PDFDocument();
  try {
    await appendSourceDocuments(mergedDocument, sourcePaths, runtime?.signal);
    runtime?.signal?.throwIfAborted();
    return { mergedDocument, stagingRootPath, stagedOutputPath };
  } catch (error) {
    mergedDocument.destroy();
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function writeMergedPdf(
  options: MergePdfOptions,
  prepared: { mergedDocument: MupdfPdfDocumentInstance; stagingRootPath: string; stagedOutputPath: string },
): Promise<CommittedConversionOutput[]> {
  const { outputPath, workspacePath, runtime } = options;
  const { mergedDocument, stagingRootPath, stagedOutputPath } = prepared;
  const artifacts: ConversionArtifactRoot[] = [{ rootPath: stagingRootPath, workspacePath }];
  try {
    await assertWritablePathInWorkspace(stagedOutputPath, workspacePath);
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    runtime?.signal?.throwIfAborted();
    await writeFile(stagedOutputPath, savePdfDocument(mergedDocument));
    runtime?.signal?.throwIfAborted();
    return await commitStagedOutputs(
      [{ stagedOutputPath, outputPath, workspacePath, stagingRootPath }],
      buildCommitOptions(runtime),
    );
  } catch (error) {
    await cleanupConversionArtifacts(artifacts, runtime?.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    mergedDocument.destroy();
  }
}

async function appendSourceDocuments(
  mergedDocument: MupdfPdfDocumentInstance,
  sourcePaths: string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  // oxlint-disable-next-line no-unreachable-loop -- Append every source document while preserving per-document cleanup.
  for (const sourcePath of sourcePaths) {
    signal?.throwIfAborted();
    const sourceBytes = await readFile(sourcePath);
    const sourceDocument = await openPdfDocument(sourceBytes);
    try {
      const pageCount = sourceDocument.countPages();
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        signal?.throwIfAborted();
        mergedDocument.graftPage(mergedDocument.countPages(), sourceDocument, pageIndex);
      }
    } finally {
      sourceDocument.destroy();
    }
  }
}

function buildCommitOptions(runtime: ConversionExecutionContext | undefined): CommitConversionOutputsOptions {
  const commitOptions: CommitConversionOutputsOptions = { operationName: 'merge-pdf' as const };
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
