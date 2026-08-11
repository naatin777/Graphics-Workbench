import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { isExcalidrawPath } from '@graphics-workbench/core/shared/source_format.js';
import { resolveOutputPath } from '@graphics-workbench/core/config/output/resolve_output_path.js';
import {
  assertExistingPathInWorkspace,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security/workspace_path.js';
import type { RsvgToolScratchOptions } from '../external_tools/run_rsvg_convert_with_ascii_scratch.js';

import type {
  CommittedConversionOutput,
  PreparedConversionOutput,
} from '@graphics-workbench/core/operations/lifecycle/commit_conversion_outputs.js';
import type {
  ConversionExecutionContext,
  ResolvedConversionRuntime,
} from '@graphics-workbench/core/operations/lifecycle/conversion_runtime.js';
import { stagingRootPathFor } from '@graphics-workbench/core/operations/lifecycle/run_id.js';
import { runStagedConversionBatch } from '@graphics-workbench/core/operations/lifecycle/run_staged_conversion_batch.js';
import { validateGeneratedPdf, writeSourceAsPdf } from './convert_to_pdf.js';
import { excalidrawToSvg, type ExcalidrawToSvgOptions } from './excalidraw_adapter.js';
import type { SvgToPdfBackend } from './tools/svg_to_pdf_tools.js';

export interface ExcalidrawPdfInput {
  sourcePath: string;
  outputTemplate: string;
  workspacePath: string;
  workspaceName: string;
}

export interface ConvertExcalidrawToPdfOptions {
  inputs: ExcalidrawPdfInput[];
  svgToPdf: SvgToPdfBackend;
  maxInputPixels: number;
  runId?: string;
  runtime?: ConversionExecutionContext;
  bundleUrl?: string;
}

export async function convertExcalidrawToPdfFiles(
  options: ConvertExcalidrawToPdfOptions,
): Promise<CommittedConversionOutput[]> {
  const operationName = 'convert-excalidraw-to-pdf';
  validateInputs(options.inputs);
  await validateInputPaths(options.inputs, operationName);
  options.runtime?.signal?.throwIfAborted();

  const scratchOptions: RsvgToolScratchOptions = { platform: process.platform };
  if (options.runtime?.outputChannel !== undefined) {
    scratchOptions.outputChannel = options.runtime.outputChannel;
  }

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName,
    runId: options.runId,
    ...(options.runtime !== undefined && { runtime: options.runtime }),
    stage: async (input, index, currentRunId, runtime) =>
      stageExcalidrawInput({
        input,
        index,
        runId: currentRunId,
        operationName,
        svgToPdf: options.svgToPdf,
        maxInputPixels: options.maxInputPixels,
        scratchOptions,
        ...(options.bundleUrl !== undefined && { bundleUrl: options.bundleUrl }),
        runtime,
      }),
  });
}

async function stageExcalidrawInput(options: {
  input: ExcalidrawPdfInput;
  index: number;
  runId: string;
  operationName: string;
  svgToPdf: SvgToPdfBackend;
  maxInputPixels: number;
  scratchOptions: RsvgToolScratchOptions;
  bundleUrl?: string;
  runtime: ResolvedConversionRuntime;
}): Promise<PreparedConversionOutput> {
  const {
    input,
    index: jobIndex,
    runId,
    operationName,
    svgToPdf,
    maxInputPixels,
    scratchOptions,
    bundleUrl,
    runtime,
  } = options;
  const stageRootPath = stagingRootPathFor(input.workspacePath, operationName, runId);
  const stageDirectory = path.join(
    stageRootPath,
    `${jobIndex + 1}-${safeName(path.basename(input.sourcePath, path.extname(input.sourcePath)))}`,
  );
  const svgPath = path.join(stageDirectory, 'source.svg');
  const stagedOutputPath = path.join(stageDirectory, 'result.pdf');

  runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(stageDirectory, input.workspacePath);
  await mkdir(stageDirectory, { recursive: true });

  const svgOptions: ExcalidrawToSvgOptions = { sourcePath: input.sourcePath, svgPath, signal: runtime.signal };
  if (bundleUrl !== undefined) {
    svgOptions.bundleUrl = bundleUrl;
  }
  await excalidrawToSvg(svgOptions);
  runtime.signal.throwIfAborted();
  await assertExistingPathInWorkspace(svgPath, input.workspacePath);

  const outputPath = resolveOutputPath(
    input.outputTemplate,
    { sourcePath: input.sourcePath, workspacePath: input.workspacePath, workspaceName: input.workspaceName },
    { allowedExtensions: ['.pdf'] },
  );
  await assertWritablePathInWorkspace(outputPath, input.workspacePath);
  await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);

  await writeSourceAsPdf({
    sourcePath: svgPath,
    outputPath: stagedOutputPath,
    workspacePath: input.workspacePath,
    maxInputPixels,
    signal: runtime.signal,
    scratchOptions,
    tools: { svgToPdfTools: svgToPdf },
  });
  runtime.signal.throwIfAborted();
  await validateGeneratedPdf(stagedOutputPath);

  return { stagedOutputPath, outputPath, workspacePath: input.workspacePath, stagingRootPath: stageRootPath };
}

async function validateInputPaths(inputs: ExcalidrawPdfInput[], operationName: string): Promise<void> {
  await Promise.all(
    inputs.flatMap((input) => [
      assertExistingPathInWorkspace(input.sourcePath, input.workspacePath),
      assertWritablePathInWorkspace(
        path.join(input.workspacePath, '.graphics-workbench', operationName),
        input.workspacePath,
      ),
      assertWritablePathInWorkspace(
        resolveOutputPath(
          input.outputTemplate,
          { sourcePath: input.sourcePath, workspacePath: input.workspacePath, workspaceName: input.workspaceName },
          { allowedExtensions: ['.pdf'] },
        ),
        input.workspacePath,
      ),
    ]),
  );
}

function validateInputs(inputs: ExcalidrawPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No Excalidraw files were selected.');
  }

  for (const input of inputs) {
    if (!isExcalidrawPath(input.sourcePath)) {
      throw new Error(`Only Excalidraw files are supported: ${input.sourcePath}`);
    }
  }
}

function safeName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_') || 'excalidraw';
}
