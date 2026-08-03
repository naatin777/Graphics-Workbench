import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

import { cleanupConversionArtifacts, type ConversionArtifactRoot } from '../lifecycle/cleanup_conversion_artifacts.js';
import {
  commitStagedOutputs,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { createStagingRoot } from '../lifecycle/run_id.js';

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

  const prepared = await prepareMerge(options);
  return writeMergedPdf(options, prepared);
}

async function prepareMerge(options: MergePdfOptions): Promise<{
  mergedDocument: PDFDocument;
  stagingRootPath: string;
  stagedOutputPath: string;
}> {
  const { sourcePaths, outputPath, workspacePath, runtime } = options;
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? `${Date.now()}-${crypto.randomUUID()}`;
  const stagingRootPath = createStagingRoot(workspacePath, 'merge-pdf', runId);
  const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
  await Promise.all([
    ...sourcePaths.map(async (sourcePath) => assertExistingPathInWorkspace(sourcePath, workspacePath)),
    assertWritablePathInWorkspace(outputPath, workspacePath),
    assertWritablePathInWorkspace(path.join(workspacePath, '.graphics-workbench', 'merge-pdf'), workspacePath),
    assertWritablePathInWorkspace(stagingRootPath, workspacePath),
    assertWritablePathInWorkspace(stagedOutputPath, workspacePath),
  ]);
  runtime?.signal?.throwIfAborted();
  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const mergedDocument = await PDFDocument.create();
  await appendSourceDocuments(mergedDocument, sourcePaths, runtime?.signal);
  runtime?.signal?.throwIfAborted();
  return { mergedDocument, stagingRootPath, stagedOutputPath };
}

async function writeMergedPdf(
  options: MergePdfOptions,
  prepared: { mergedDocument: PDFDocument; stagingRootPath: string; stagedOutputPath: string },
): Promise<CommittedConversionOutput[]> {
  const { outputPath, workspacePath, runtime } = options;
  const { mergedDocument, stagingRootPath, stagedOutputPath } = prepared;
  const artifacts: ConversionArtifactRoot[] = [{ rootPath: stagingRootPath, workspacePath }];
  try {
    await assertWritablePathInWorkspace(stagedOutputPath, workspacePath);
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    runtime?.signal?.throwIfAborted();
    await writeFile(stagedOutputPath, await mergedDocument.save());
    runtime?.signal?.throwIfAborted();
    return await commitStagedOutputs(
      [{ stagedOutputPath, outputPath, workspacePath, stagingRootPath }],
      commitOptionsForRuntime(runtime),
    );
  } catch (error) {
    await cleanupConversionArtifacts(artifacts, runtime?.outputChannel, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function appendSourceDocuments(
  mergedDocument: PDFDocument,
  sourcePaths: string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const sourcePath of sourcePaths) {
    signal?.throwIfAborted();
    const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
    signal?.throwIfAborted();
    const pages = await mergedDocument.copyPages(sourceDocument, sourceDocument.getPageIndices());

    for (const page of pages) {
      signal?.throwIfAborted();
      mergedDocument.addPage(page);
    }
  }
}

function commitOptionsForRuntime(runtime: ConversionExecutionContext | undefined): CommitConversionOutputsOptions {
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
