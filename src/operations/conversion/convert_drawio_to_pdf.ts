import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

import {
  isDrawioPath,
  isEditableDrawioImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../application/policy/source_format.js';
import { isWindowsReservedPathComponent, resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { loadMupdf, openPdfDocument, savePdfDocument } from '../pdf/mupdf.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { validateGeneratedPdf } from './convert_to_pdf.js';

export interface DrawioPdfJob {
  sourcePath: string;
  outputTemplate: string;
  workspacePath: string;
  workspaceName: string;
}

export interface ConvertDrawioToPdfOptions {
  jobs: DrawioPdfJob[];
  drawioPath: string;
  outputMode: 'page-pdfs' | 'single-pdf';
  runId?: string;
  runtime?: ConversionExecutionContext;
  runDrawio?: RunDrawio;
}

type RunDrawio = (
  executable: string,
  args: string[],
  signal?: AbortSignal,
  outputChannel?: ConversionExecutionContext['outputChannel'],
) => Promise<void>;

export async function convertDrawioToPdfFiles(
  options: ConvertDrawioToPdfOptions,
): Promise<CommittedConversionOutput[]> {
  const operationName = options.outputMode === 'page-pdfs' ? 'convert-drawio-to-pdf' : 'convert-drawio-to-pdf-directly';
  validateJobs(options.jobs, options.outputMode);
  await validateJobPaths(options.jobs, operationName, options.outputMode);

  await assertPreflightPassed(preflightOptionsFromRuntime(options.runtime));

  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName,
    runId,
    ...(options.runtime !== undefined && { runtime: options.runtime }),
    stage: async (job, index, currentRunId, runtime) =>
      stageDrawioJob({
        job,
        index,
        runId: currentRunId,
        operationName,
        outputMode: options.outputMode,
        drawioPath: options.drawioPath,
        ...(options.runDrawio !== undefined && { runDrawio: options.runDrawio }),
        runtime,
      }),
  });
}

async function stageDrawioJob(options: {
  job: DrawioPdfJob;
  index: number;
  runId: string;
  operationName: string;
  outputMode: 'page-pdfs' | 'single-pdf';
  drawioPath: string;
  runDrawio?: RunDrawio;
  runtime: ConversionExecutionContext;
}): Promise<PreparedConversionOutput[]> {
  const { job, index: jobIndex, runId, operationName, outputMode, drawioPath, runDrawio, runtime } = options;
  const stageRootPath = createStagingRoot(job.workspacePath, operationName, runId);
  const logicalSourcePath = logicalSourcePathForOutputTemplate(job.sourcePath);
  const stageDirectory = path.join(
    stageRootPath,
    `${jobIndex + 1}-${safeName(path.basename(logicalSourcePath, path.extname(logicalSourcePath)))}`,
  );
  const allPagesPdfPath = path.join(stageDirectory, 'all-pages.pdf');

  runtime.signal?.throwIfAborted();
  await assertWritablePathInWorkspace(stageDirectory, job.workspacePath);
  await mkdir(stageDirectory, { recursive: true });
  const conversionInputPath = await prepareDrawioInput({
    sourcePath: job.sourcePath,
    stageDirectory,
    workspacePath: job.workspacePath,
    drawioPath,
    ...(runDrawio !== undefined && { runDrawio }),
    runtime,
  });
  await assertHasDrawioContent(conversionInputPath);

  await runDrawioCommand(
    drawioPath,
    ['-x', '-f', 'pdf', '-o', allPagesPdfPath, '-t', '-a', '--crop', conversionInputPath],
    runtime,
    runDrawio,
  );
  await assertExistingPathInWorkspace(allPagesPdfPath, job.workspacePath);
  await validateGeneratedPdf(allPagesPdfPath);

  const sourceDocument = await openPdfDocument(await readFile(allPagesPdfPath));
  try {
    const pageCount = sourceDocument.countPages();
    if (pageCount === 0) {
      throw new Error(`Draw.io produced an empty PDF: ${job.sourcePath}`);
    }

    const outputContext = {
      sourcePath: logicalSourcePath,
      workspacePath: job.workspacePath,
      workspaceName: job.workspaceName,
    };

    if (outputMode === 'single-pdf') {
      const outputPath = resolveOutputPath(job.outputTemplate, outputContext, { allowedExtensions: ['.pdf'] });
      await assertWritablePathInWorkspace(outputPath, job.workspacePath);
      return [
        {
          stagedOutputPath: allPagesPdfPath,
          outputPath,
          workspacePath: job.workspacePath,
          stagingRootPath: stageRootPath,
        },
      ];
    }

    const pageNames = await readDrawioPageNames(conversionInputPath);
    if (pageNames.length !== pageCount) {
      throw new Error(
        `Draw.io page count does not match XML diagrams: ${job.sourcePath} (${pageCount} PDF pages, ${pageNames.length} diagrams)`,
      );
    }

    const pageDirectory = path.join(stageDirectory, 'pages');
    await assertWritablePathInWorkspace(pageDirectory, job.workspacePath);
    await mkdir(pageDirectory, { recursive: true });

    const outputs: PreparedConversionOutput[] = [];
    const usedPageNames = new Set<string>();
    const mupdf = await loadMupdf();
    for (let index = 0; index < pageCount; index += 1) {
      runtime.signal?.throwIfAborted();
      const pageDocument = new mupdf.PDFDocument();
      pageDocument.graftPage(0, sourceDocument, index);
      if (pageDocument.countPages() !== 1) {
        pageDocument.destroy();
        throw new Error(`Could not copy Draw.io page ${index + 1}: ${job.sourcePath}`);
      }

      const stagedOutputPath = path.join(pageDirectory, `${index + 1}.pdf`);
      await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
      await writeFile(stagedOutputPath, savePdfDocument(pageDocument));
      await validateGeneratedPdf(stagedOutputPath);

      const outputPath = resolveOutputPath(
        job.outputTemplate,
        {
          ...outputContext,
          page: uniquePageName(safePageName(pageNames[index], index + 1), usedPageNames),
        },
        { allowedExtensions: ['.pdf'] },
      );
      await assertWritablePathInWorkspace(outputPath, job.workspacePath);
      outputs.push({
        stagedOutputPath,
        outputPath,
        workspacePath: job.workspacePath,
        stagingRootPath: stageRootPath,
      });
    }

    return outputs;
  } finally {
    sourceDocument.destroy();
  }
}

async function prepareDrawioInput(options: {
  sourcePath: string;
  stageDirectory: string;
  workspacePath: string;
  drawioPath: string;
  runDrawio?: RunDrawio;
  runtime: ConversionExecutionContext;
}): Promise<string> {
  const drawioSourcePath = path.join(options.stageDirectory, 'source.drawio');
  await assertWritablePathInWorkspace(drawioSourcePath, options.workspacePath);
  options.runtime.signal?.throwIfAborted();
  await (isEditableDrawioImagePath(options.sourcePath)
    ? runDrawioCommand(
        options.drawioPath,
        ['-x', '-f', 'xml', '-o', drawioSourcePath, options.sourcePath],
        options.runtime,
        options.runDrawio,
      )
    : copyFileWithAbort(options.sourcePath, drawioSourcePath, undefined, options.runtime.signal));
  await assertExistingPathInWorkspace(drawioSourcePath, options.workspacePath);
  return drawioSourcePath;
}

async function readDrawioPageNames(sourcePath: string): Promise<string[]> {
  const source = await readFile(sourcePath, 'utf8');
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'diagram' }).parse(
    source,
  );
  const mxfile = isRecord(parsed) && isRecord(parsed.mxfile) ? parsed.mxfile : undefined;
  const diagrams = mxfile && Array.isArray(mxfile.diagram) ? mxfile.diagram : [];

  return diagrams.map((diagram, index) => {
    const name = isRecord(diagram) ? diagram['@_name'] : undefined;
    return typeof name === 'string' ? name : String(index + 1);
  });
}

/**
 * The drawio CLI fails `--crop` on diagrams without any vertex or edge cell,
 * so detect empty content up front and report it as a clear error.
 */
async function assertHasDrawioContent(sourcePath: string): Promise<void> {
  const source = await readFile(sourcePath, 'utf8');
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'diagram' }).parse(
    source,
  );
  const mxfile = isRecord(parsed) && isRecord(parsed.mxfile) ? parsed.mxfile : undefined;
  const diagrams = mxfile && Array.isArray(mxfile.diagram) ? mxfile.diagram : [];

  if (!diagrams.some((diagram) => diagramHasContent(diagram))) {
    throw new Error('The Draw.io file contains no content to export.');
  }
}

function diagramHasContent(diagram: unknown): boolean {
  const graphModel = isRecord(diagram) && isRecord(diagram.mxGraphModel) ? diagram.mxGraphModel : undefined;
  const root = graphModel && isRecord(graphModel.root) ? graphModel.root : undefined;
  if (root === undefined || !('mxCell' in root)) {
    return false;
  }
  const cells = Array.isArray(root.mxCell) ? root.mxCell : [root.mxCell];
  return cells.some((cell) => isRecord(cell) && (cell['@_vertex'] === '1' || cell['@_edge'] === '1'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function runDrawioCommand(
  executable: string,
  args: string[],
  runtime: ConversionExecutionContext,
  runDrawio?: RunDrawio,
): Promise<void> {
  await (runDrawio ?? executeDrawio)(executable, args, runtime.signal, runtime.outputChannel);
}

async function executeDrawio(
  executable: string,
  args: string[],
  signal?: AbortSignal,
  outputChannel?: ConversionExecutionContext['outputChannel'],
): Promise<void> {
  const toolOptions: Parameters<typeof runExternalTool>[0] = { toolName: 'drawio' as const, executable, args };
  if (signal !== undefined) {
    toolOptions.signal = signal;
  }
  if (outputChannel !== undefined) {
    toolOptions.outputChannel = outputChannel;
  }
  await runExternalTool(toolOptions);
}

async function validateJobPaths(
  jobs: DrawioPdfJob[],
  operationName: string,
  outputMode: 'page-pdfs' | 'single-pdf',
): Promise<void> {
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
          {
            sourcePath: logicalSourcePathForOutputTemplate(job.sourcePath),
            workspacePath: job.workspacePath,
            workspaceName: job.workspaceName,
            ...(outputMode === 'page-pdfs' ? { page: '1' } : {}),
          },
          { allowedExtensions: ['.pdf'] },
        ),
        job.workspacePath,
      ),
    ]),
  );
}

function validateJobs(jobs: DrawioPdfJob[], outputMode: 'page-pdfs' | 'single-pdf'): void {
  if (jobs.length === 0) {
    throw new Error('No Draw.io files were selected.');
  }

  for (const job of jobs) {
    if (!isDrawioPath(job.sourcePath)) {
      throw new Error(`Only Draw.io files are supported: ${job.sourcePath}`);
    }

    if (outputMode === 'page-pdfs' && !job.outputTemplate.includes('${page}')) {
      throw new Error('outputPaths.convertDrawioToPdf must contain ${page} for split Draw.io conversion.');
    }
  }
}

function safeName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_') || 'drawio';
}

function safePageName(value: string | undefined, page: number): string {
  // oxlint-disable-next-line unicorn/prefer-spread -- String spread trips typescript/no-misused-spread; Array.from iterates code points identically.
  const normalized = Array.from(value ?? String(page))
    .map((character) => ((character.codePointAt(0) ?? 0) <= 31 ? '_' : character))
    .join('')
    .replaceAll(/[\\/<>:"|?*]/g, '_')
    .trim()
    .replaceAll(/[. ]+$/g, '');

  const pageName = normalized || String(page);
  return isWindowsReservedPathComponent(pageName) ? `_${pageName}` : pageName;
}

function uniquePageName(pageName: string, usedPageNames: Set<string>): string {
  const normalizedPageName = pageName.toLowerCase();
  let candidate = pageName;
  let suffix = 2;

  while (usedPageNames.has(candidate.toLowerCase())) {
    candidate = `${pageName}-${suffix}`;
    suffix += 1;
  }

  usedPageNames.add(normalizedPageName);
  usedPageNames.add(candidate.toLowerCase());
  return candidate;
}
