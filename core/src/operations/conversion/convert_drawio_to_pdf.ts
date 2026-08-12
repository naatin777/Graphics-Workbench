import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

import {
  isDrawioPath,
  isEditableDrawioImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../shared/source_format.js';
import { isWindowsReservedPathComponent, resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

import { loadMupdf, openPdfDocument, savePdfDocument, type MupdfPdfDocumentInstance } from '../pdf/mupdf.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { RunDrawio } from './tools/drawio_tools.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import type { ConversionExecutionContext, ResolvedConversionRuntime } from '../lifecycle/conversion_runtime.js';
import { copyFileWithAbort } from '../lifecycle/copy_file_with_abort.js';
import { stagingRootPathFor } from '../lifecycle/run_id.js';
import { validateGeneratedPdf } from './convert_to_pdf.js';

export interface DrawioPdfInput {
  sourcePath: string;
  outputTemplate: string;
  workspacePath: string;
  workspaceName: string;
}

interface ConvertDrawioToPdfOptions {
  inputs: DrawioPdfInput[];
  drawioPath: string;
  runId?: string;
  runtime: ConversionExecutionContext;
  runDrawio: RunDrawio;
}

/** Renders each Draw.io file to one PDF per page. */
export async function convertDrawioToPagePdfs(
  options: ConvertDrawioToPdfOptions,
): Promise<CommittedConversionOutput[]> {
  const operationName = 'convert-drawio-to-pdf';
  validatePagePdfInputs(options.inputs);
  await validateInputPaths(options.inputs, operationName);

  options.runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName,
    runId: options.runId,
    runtime: options.runtime,
    stage: async (input, index, currentRunId, runtime) =>
      splitDrawioPdfPages(input, index, currentRunId, operationName, options.drawioPath, options.runDrawio, runtime),
  });
}

/** Renders each Draw.io file to one PDF. */
export async function convertDrawioToSinglePdf(
  options: ConvertDrawioToPdfOptions,
): Promise<CommittedConversionOutput[]> {
  const operationName = 'convert-drawio-to-single-pdf';
  validateInputs(options.inputs);
  await validateInputPaths(options.inputs, operationName);

  options.runtime.signal?.throwIfAborted();

  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName,
    runId: options.runId,
    runtime: options.runtime,
    stage: async (input, index, currentRunId, runtime) =>
      keepSinglePdf(input, index, currentRunId, operationName, options.drawioPath, options.runDrawio, runtime),
  });
}

interface RenderedDrawioPdf {
  stageRootPath: string;
  stageDirectory: string;
  allPagesPdfPath: string;
  sourceDocument: MupdfPdfDocumentInstance;
  pageCount: number;
  outputContext: {
    sourcePath: string;
    workspacePath: string;
    workspaceName: string;
  };
  logicalSourcePath: string;
}

/** Draw.ioから一時的な全ページPDFを生成し、stagingとpage countを確定する。 */
async function renderDrawioToTempPdf(
  input: DrawioPdfInput,
  index: number,
  runId: string,
  operationName: string,
  drawioPath: string,
  runDrawio: RunDrawio,
  runtime: ResolvedConversionRuntime,
): Promise<RenderedDrawioPdf> {
  const stageRootPath = stagingRootPathFor(input.workspacePath, operationName, runId);
  const logicalSourcePath = logicalSourcePathForOutputTemplate(input.sourcePath);
  const stageDirectory = path.join(
    stageRootPath,
    `${index + 1}-${safeName(path.basename(logicalSourcePath, path.extname(logicalSourcePath)))}`,
  );
  const allPagesPdfPath = path.join(stageDirectory, 'all-pages.pdf');

  runtime.signal.throwIfAborted();
  await assertWritablePathInWorkspace(stageDirectory, input.workspacePath);
  await mkdir(stageDirectory, { recursive: true });
  const conversionInputPath = await prepareDrawioInput({
    sourcePath: input.sourcePath,
    stageDirectory,
    workspacePath: input.workspacePath,
    drawioPath,
    runDrawio,
    runtime,
  });
  await assertHasDrawioContent(conversionInputPath);

  await runDrawioCommand(
    drawioPath,
    ['-x', '-f', 'pdf', '-o', allPagesPdfPath, '-t', '-a', '--crop', conversionInputPath],
    runtime,
    runDrawio,
  );
  await assertExistingPathInWorkspace(allPagesPdfPath, input.workspacePath);
  await validateGeneratedPdf(allPagesPdfPath);

  const sourceDocument = await openPdfDocument(await readFile(allPagesPdfPath));
  const pageCount = sourceDocument.countPages();
  if (pageCount === 0) {
    sourceDocument.destroy();
    throw new Error(`Draw.io produced an empty PDF: ${input.sourcePath}`);
  }

  const outputContext = {
    sourcePath: logicalSourcePath,
    workspacePath: input.workspacePath,
    workspaceName: input.workspaceName,
  };

  return {
    stageRootPath,
    stageDirectory,
    allPagesPdfPath,
    sourceDocument,
    pageCount,
    outputContext,
    logicalSourcePath,
  };
}

async function keepSinglePdf(
  input: DrawioPdfInput,
  index: number,
  runId: string,
  operationName: string,
  drawioPath: string,
  runDrawio: RunDrawio,
  runtime: ResolvedConversionRuntime,
): Promise<PreparedConversionOutput[]> {
  const rendered = await renderDrawioToTempPdf(input, index, runId, operationName, drawioPath, runDrawio, runtime);
  try {
    const outputPath = resolveOutputPath(input.outputTemplate, rendered.outputContext, { allowedExtensions: ['.pdf'] });
    await assertWritablePathInWorkspace(outputPath, input.workspacePath);
    return [
      {
        stagedOutputPath: rendered.allPagesPdfPath,
        outputPath,
        workspacePath: input.workspacePath,
        stagingRootPath: rendered.stageRootPath,
      },
    ];
  } finally {
    rendered.sourceDocument.destroy();
  }
}

async function splitDrawioPdfPages(
  input: DrawioPdfInput,
  index: number,
  runId: string,
  operationName: string,
  drawioPath: string,
  runDrawio: RunDrawio,
  runtime: ResolvedConversionRuntime,
): Promise<PreparedConversionOutput[]> {
  const rendered = await renderDrawioToTempPdf(input, index, runId, operationName, drawioPath, runDrawio, runtime);
  const { sourceDocument, pageCount, outputContext, stageDirectory, stageRootPath } = rendered;
  try {
    const pageNames = await readDrawioPageNames(stageDirectory, input.sourcePath);
    if (pageNames.length !== pageCount) {
      throw new Error(
        `Draw.io page count does not match XML diagrams: ${input.sourcePath} (${pageCount} PDF pages, ${pageNames.length} diagrams)`,
      );
    }

    const pageDirectory = path.join(stageDirectory, 'pages');
    await assertWritablePathInWorkspace(pageDirectory, input.workspacePath);
    await mkdir(pageDirectory, { recursive: true });

    const outputs: PreparedConversionOutput[] = [];
    const usedPageNames = new Set<string>();
    const mupdf = await loadMupdf();
    // oxlint-disable-next-line no-unreachable-loop -- emit one staged PDF per Draw.io page.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      runtime.signal.throwIfAborted();
      const pageDocument = new mupdf.PDFDocument();
      try {
        pageDocument.graftPage(0, sourceDocument, pageIndex);
        if (pageDocument.countPages() !== 1) {
          throw new Error(`Could not copy Draw.io page ${pageIndex + 1}: ${input.sourcePath}`);
        }

        const stagedOutputPath = path.join(pageDirectory, `${pageIndex + 1}.pdf`);
        await assertWritablePathInWorkspace(stagedOutputPath, input.workspacePath);
        await writeFile(stagedOutputPath, savePdfDocument(pageDocument));
        await validateGeneratedPdf(stagedOutputPath);

        const outputPath = resolveOutputPath(
          input.outputTemplate,
          {
            ...outputContext,
            page: uniquePageName(safePageName(pageNames[pageIndex], pageIndex + 1), usedPageNames),
          },
          { allowedExtensions: ['.pdf'] },
        );
        await assertWritablePathInWorkspace(outputPath, input.workspacePath);
        outputs.push({
          stagedOutputPath,
          outputPath,
          workspacePath: input.workspacePath,
          stagingRootPath: stageRootPath,
        });
      } finally {
        pageDocument.destroy();
      }
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
  runDrawio: RunDrawio;
  runtime: ResolvedConversionRuntime;
}): Promise<string> {
  const drawioSourcePath = path.join(options.stageDirectory, 'source.drawio');
  await assertWritablePathInWorkspace(drawioSourcePath, options.workspacePath);
  options.runtime.signal.throwIfAborted();
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

async function readDrawioPageNames(stageDirectory: string, sourcePath: string): Promise<string[]> {
  const source = await readFile(path.join(stageDirectory, 'source.drawio'), 'utf8');
  // oxlint-disable-next-line typescript/no-restricted-types -- 外部XMLの未検証パース結果。直後のisRecordで検証する境界。
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'diagram' }).parse(
    source,
  );
  const mxfile = isRecord(parsed) && isRecord(parsed.mxfile) ? parsed.mxfile : undefined;
  const diagrams = mxfile && Array.isArray(mxfile.diagram) ? mxfile.diagram : [];

  const pageNames = diagrams.map((diagram, diagramIndex) => {
    const name = isRecord(diagram) ? diagram['@_name'] : undefined;
    return typeof name === 'string' ? name : String(diagramIndex + 1);
  });

  if (pageNames.length === 0) {
    throw new Error(`Draw.io produced no diagrams: ${sourcePath}`);
  }

  return pageNames;
}

/**
 * The drawio CLI fails `--crop` on diagrams without any vertex or edge cell,
 * so detect empty content up front and report it as a clear error.
 */
async function assertHasDrawioContent(sourcePath: string): Promise<void> {
  const source = await readFile(sourcePath, 'utf8');
  // oxlint-disable-next-line typescript/no-restricted-types -- 外部XMLの未検証パース結果。直後のisRecordで検証する境界。
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'diagram' }).parse(
    source,
  );
  const mxfile = isRecord(parsed) && isRecord(parsed.mxfile) ? parsed.mxfile : undefined;
  const diagrams = mxfile && Array.isArray(mxfile.diagram) ? mxfile.diagram : [];

  if (!diagrams.some((diagram) => diagramHasContent(diagram))) {
    throw new Error('The Draw.io file contains no content to export.');
  }
}

// oxlint-disable-next-line typescript/no-restricted-types -- 外部XMLのパース結果のセル値であり、形状が動的に決まる境界。
function diagramHasContent(diagram: unknown): boolean {
  const graphModel = isRecord(diagram) && isRecord(diagram.mxGraphModel) ? diagram.mxGraphModel : undefined;
  const root = graphModel && isRecord(graphModel.root) ? graphModel.root : undefined;
  if (root === undefined || !('mxCell' in root)) {
    return false;
  }
  const cells = Array.isArray(root.mxCell) ? root.mxCell : [root.mxCell];
  return cells.some((cell) => isRecord(cell) && (cell['@_vertex'] === '1' || cell['@_edge'] === '1'));
}

// oxlint-disable-next-line typescript/no-restricted-types -- 型ガード: 外部XML/JS値がオブジェクトか検証する。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function runDrawioCommand(
  executable: string,
  args: string[],
  runtime: ResolvedConversionRuntime,
  runDrawio: RunDrawio,
): Promise<void> {
  await runDrawio(executable, args, runtime.signal, runtime.outputChannel);
}

async function validateInputPaths(inputs: DrawioPdfInput[], operationName: string): Promise<void> {
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
          {
            sourcePath: logicalSourcePathForOutputTemplate(input.sourcePath),
            workspacePath: input.workspacePath,
            workspaceName: input.workspaceName,
          },
          { allowedExtensions: ['.pdf'] },
        ),
        input.workspacePath,
      ),
    ]),
  );
}

function validateInputs(inputs: DrawioPdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No Draw.io files were selected.');
  }

  for (const input of inputs) {
    if (!isDrawioPath(input.sourcePath)) {
      throw new Error(`Only Draw.io files are supported: ${input.sourcePath}`);
    }
  }
}

function validatePagePdfInputs(inputs: DrawioPdfInput[]): void {
  validateInputs(inputs);

  for (const input of inputs) {
    if (!input.outputTemplate.includes('${page}')) {
      throw new Error('outputPath.split.pdf must contain ${page} for split Draw.io input.');
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
