import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { isExcalidrawPath } from '../../application/policy/source_format.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import type { RsvgToolScratchOptions } from '../external_tools/run_rsvg_convert_with_ascii_scratch.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { validateGeneratedPdf, writeSourceAsPdf } from './convert_to_pdf.js';
import { excalidrawToSvg, type ExcalidrawToSvgOptions } from './excalidraw_adapter.js';
import type { SvgToPdfBackend } from './tools/index.js';

export interface ExcalidrawPdfJob {
  sourcePath: string;
  outputTemplate: string;
  workspacePath: string;
  workspaceName: string;
}

export interface ConvertExcalidrawToPdfOptions {
  jobs: ExcalidrawPdfJob[];
  svgToPdf: SvgToPdfBackend;
  runId?: string;
  runtime?: ConversionExecutionContext;
  bundleUrl?: string;
}

export async function convertExcalidrawToPdfFiles(
  options: ConvertExcalidrawToPdfOptions,
): Promise<CommittedConversionOutput[]> {
  const operationName = 'convert-excalidraw-to-pdf';
  validateJobs(options.jobs);
  await validateJobPaths(options.jobs, operationName);
  await assertPreflightPassed(preflightOptionsFromRuntime(options.runtime));

  const runId = options.runId ?? createRunId();
  const scratchOptions: RsvgToolScratchOptions = { platform: process.platform };
  if (options.runtime?.outputChannel !== undefined) {
    scratchOptions.outputChannel = options.runtime.outputChannel;
  }

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName,
    runId,
    ...(options.runtime !== undefined && { runtime: options.runtime }),
    stage: async (job, index, currentRunId, runtime) =>
      stageExcalidrawJob({
        job,
        index,
        runId: currentRunId,
        operationName,
        svgToPdf: options.svgToPdf,
        scratchOptions,
        ...(options.bundleUrl !== undefined && { bundleUrl: options.bundleUrl }),
        runtime,
      }),
  });
}

async function stageExcalidrawJob(options: {
  job: ExcalidrawPdfJob;
  index: number;
  runId: string;
  operationName: string;
  svgToPdf: SvgToPdfBackend;
  scratchOptions: RsvgToolScratchOptions;
  bundleUrl?: string;
  runtime: ConversionExecutionContext;
}): Promise<PreparedConversionOutput> {
  const { job, index: jobIndex, runId, operationName, svgToPdf, scratchOptions, bundleUrl, runtime } = options;
  const stageRootPath = createStagingRoot(job.workspacePath, operationName, runId);
  const stageDirectory = path.join(
    stageRootPath,
    `${jobIndex + 1}-${safeName(path.basename(job.sourcePath, path.extname(job.sourcePath)))}`,
  );
  const svgPath = path.join(stageDirectory, 'source.svg');
  const stagedOutputPath = path.join(stageDirectory, 'result.pdf');

  runtime.signal?.throwIfAborted();
  await assertWritablePathInWorkspace(stageDirectory, job.workspacePath);
  await mkdir(stageDirectory, { recursive: true });

  const svgOptions: ExcalidrawToSvgOptions = { sourcePath: job.sourcePath, svgPath };
  if (runtime.signal !== undefined) {
    svgOptions.signal = runtime.signal;
  }
  if (bundleUrl !== undefined) {
    svgOptions.bundleUrl = bundleUrl;
  }
  await excalidrawToSvg(svgOptions);
  runtime.signal?.throwIfAborted();
  await assertExistingPathInWorkspace(svgPath, job.workspacePath);

  const outputPath = resolveOutputPath(
    job.outputTemplate,
    { sourcePath: job.sourcePath, workspacePath: job.workspacePath, workspaceName: job.workspaceName },
    { allowedExtensions: ['.pdf'] },
  );
  await assertWritablePathInWorkspace(outputPath, job.workspacePath);
  await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);

  await writeSourceAsPdf({
    sourcePath: svgPath,
    outputPath: stagedOutputPath,
    workspacePath: job.workspacePath,
    ...(runtime.signal !== undefined && { signal: runtime.signal }),
    scratchOptions,
    tools: { svgToPdfTools: svgToPdf },
  });
  runtime.signal?.throwIfAborted();
  await validateGeneratedPdf(stagedOutputPath);

  return { stagedOutputPath, outputPath, workspacePath: job.workspacePath, stagingRootPath: stageRootPath };
}

async function validateJobPaths(jobs: ExcalidrawPdfJob[], operationName: string): Promise<void> {
  await Promise.all(
    jobs.flatMap((job) => [
      assertExistingPathInWorkspace(job.sourcePath, job.workspacePath),
      assertWritablePathInWorkspace(
        path.join(job.workspacePath, '.graphics-workbench', operationName),
        job.workspacePath,
      ),
      assertWritablePathInWorkspace(
        resolveOutputPath(
          job.outputTemplate,
          { sourcePath: job.sourcePath, workspacePath: job.workspacePath, workspaceName: job.workspaceName },
          { allowedExtensions: ['.pdf'] },
        ),
        job.workspacePath,
      ),
    ]),
  );
}

function validateJobs(jobs: ExcalidrawPdfJob[]): void {
  if (jobs.length === 0) {
    throw new Error('No Excalidraw files were selected.');
  }

  for (const job of jobs) {
    if (!isExcalidrawPath(job.sourcePath)) {
      throw new Error(`Only Excalidraw files are supported: ${job.sourcePath}`);
    }
  }
}

function safeName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_') || 'excalidraw';
}
