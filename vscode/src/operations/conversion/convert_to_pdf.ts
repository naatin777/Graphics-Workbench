import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { toErrorMessage } from '@graphics-workbench/core/shared/error.js';
import {
  loadMupdf,
  openPdfDocument,
  savePdfDocument,
  type MupdfPdfDocumentInstance,
  type MupdfPdfPage,
} from '@graphics-workbench/core/operations/pdf/mupdf.js';

import {
  isEditableDrawioImagePath,
  isSupportedPdfConversionSource,
  isRasterImagePath,
  isSameSourceFormat,
} from '@graphics-workbench/core/shared/source_format.js';
import {
  closeRasterPipeline,
  isRasterInputPixelLimitError,
  openRasterInput,
  readRasterAnimationMetadata,
  formatRasterInputPixelLimitMessage,
  type RasterAnimationMetadata,
} from '@graphics-workbench/core/operations/conversion/raster_input.js';

import { assertWritablePathInWorkspace } from '@graphics-workbench/core/security/workspace_path.js';
import { validatePdfPathInputs } from '../pdf/pdf_path_validation.js';

import type {
  CommittedConversionOutput,
  PreparedConversionOutput,
} from '@graphics-workbench/core/operations/lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '@graphics-workbench/core/operations/lifecycle/conversion_runtime.js';
import { runExternalTool } from '@graphics-workbench/core/operations/external_tools/run_external_tool.js';
import {
  runRsvgConvertWithAsciiScratch,
  type RsvgToolScratchOptions,
} from '../external_tools/run_rsvg_convert_with_ascii_scratch.js';
import { runStagedConversionBatch } from '@graphics-workbench/core/operations/lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '@graphics-workbench/core/operations/lifecycle/run_id.js';
import type { DrawioBackend } from '@graphics-workbench/core/operations/conversion/tools/drawio_tools.js';
import type { SvgToPdfBackend } from './tools/svg_to_pdf_tools.js';

const svgExtension = '.svg';

export function validateSvgToPdfOptions(options: SvgToPdfBackend): void {
  if (options.engine === 'chrome' && options.chromePath === '') {
    throw new Error('Chrome executable is not configured. Set graphics-workbench.execPath.chrome.');
  }
}

export interface PdfInput {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
}

export interface WriteSourceAsPdfOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal: AbortSignal;
  maxInputPixels: number;
  page?: number;
  tools?: {
    svgToPdfTools?: SvgToPdfBackend;
    drawioTools?: DrawioBackend;
  };
  scratchOptions?: RsvgToolScratchOptions;
}

interface StageSourceToPdfOptions {
  signal: AbortSignal;
  svgToPdfTools: SvgToPdfBackend | undefined;
  drawioTools: DrawioBackend | undefined;
  scratchOptions: RsvgToolScratchOptions;
  maxInputPixels: number;
}

interface WriteRasterImageAsPdfOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal: AbortSignal;
  maxInputPixels: number;
  framePage: number | undefined;
}

interface WriteSvgAsPdfOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal: AbortSignal;
  svgToPdf: SvgToPdfBackend | undefined;
  scratchOptions: RsvgToolScratchOptions;
}

export interface ConvertToPdfFilesOptions {
  inputs: PdfInput[];
  runtime: ConversionExecutionContext;
  runId?: string;
  tools?: {
    svgToPdfTools?: SvgToPdfBackend;
    drawioTools?: DrawioBackend;
  };
  platform?: NodeJS.Platform;
  maxInputPixels: number;
  scratchBaseCandidates?: readonly string[];
}

export async function convertToPdfFiles(options: ConvertToPdfFilesOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  const { maxInputPixels } = options;
  runtime.signal?.throwIfAborted();
  validateConversions(options.inputs);
  await validatePdfPathInputs(options.inputs, 'convert-to-pdf');
  runtime.signal?.throwIfAborted();

  const platform = options.platform ?? process.platform;
  const scratchOptions: RsvgToolScratchOptions = { platform };
  if (runtime.outputChannel !== undefined) {
    scratchOptions.outputChannel = runtime.outputChannel;
  }
  if (options.scratchBaseCandidates !== undefined) {
    scratchOptions.scratchBaseCandidates = options.scratchBaseCandidates;
  }
  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'convert-to-pdf',
    runId: options.runId,
    runtime,
    stage: async (input, index, currentRunId, batchRuntime) =>
      stageSourceToPdf(input, index, currentRunId, {
        signal: batchRuntime.signal,
        svgToPdfTools: options.tools?.svgToPdfTools,
        drawioTools: options.tools?.drawioTools,
        scratchOptions,
        maxInputPixels,
      }),
  });
}

async function stageSourceToPdf(
  input: PdfInput,
  index: number,
  runId: string,
  options: StageSourceToPdfOptions,
): Promise<PreparedConversionOutput> {
  const { signal, svgToPdfTools, drawioTools, scratchOptions, maxInputPixels } = options;
  signal.throwIfAborted();
  const stagedOutputPath = path.join(
    input.workspacePath,
    '.graphics-workbench',
    'convert-to-pdf',
    runId,
    `${index + 1}`,
    'result.pdf',
  );
  const stagingRootPath = stagingRootPathFor(input.workspacePath, 'convert-to-pdf', runId);

  const writeOptions: WriteSourceAsPdfOptions = {
    sourcePath: input.sourcePath,
    outputPath: stagedOutputPath,
    workspacePath: input.workspacePath,
    scratchOptions,
    signal,
    maxInputPixels,
  };
  if (input.page !== undefined) {
    writeOptions.page = input.page;
  }
  if (svgToPdfTools !== undefined) {
    writeOptions.tools = { ...writeOptions.tools, svgToPdfTools };
  }
  if (drawioTools !== undefined) {
    writeOptions.tools = { ...writeOptions.tools, drawioTools };
  }
  await writeSourceAsPdf(writeOptions);
  signal.throwIfAborted();
  await validateGeneratedPdf(stagedOutputPath);
  signal.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: input.outputPath,
    workspacePath: input.workspacePath,
    stagingRootPath,
  };
}

export async function writeSourceAsPdf(options: WriteSourceAsPdfOptions): Promise<void> {
  const { sourcePath, outputPath, workspacePath, signal, maxInputPixels, tools, scratchOptions = {} } = options;
  const { svgToPdfTools, drawioTools } = tools ?? {};
  const extension = path.extname(sourcePath).toLowerCase();

  if (options.page === undefined && isRasterImagePath(sourcePath)) {
    const animation = await readRasterAnimationMetadata(sourcePath, maxInputPixels);
    if (animation !== undefined) {
      // アニメーション（GIF / マルチページTIFF / アニメWebP）は全フレームを
      // 1つのPDFの各ページへ展開する。最初のフレームだけに切り詰めない。
      await writeAnimatedRasterAsPdf({
        sourcePath,
        outputPath,
        workspacePath,
        animation,
        signal,
        maxInputPixels,
      });
      return;
    }
  }

  if (extension === '.pdf') {
    await assertWritablePathInWorkspace(outputPath, workspacePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await readFile(sourcePath));
    return;
  }

  if (isEditableDrawioImagePath(sourcePath)) {
    await writeDrawioAsPdf(sourcePath, outputPath, workspacePath, signal, drawioTools);
    return;
  }

  if (extension === svgExtension) {
    await writeSvgAsPdf({
      sourcePath,
      outputPath,
      workspacePath,
      signal,
      svgToPdf: svgToPdfTools,
      scratchOptions,
    });
    return;
  }

  await writeRasterImageAsPdf({
    sourcePath,
    outputPath,
    workspacePath,
    signal,
    maxInputPixels,
    framePage: options.page,
  });
}

async function writeDrawioAsPdf(
  sourcePath: string,
  outputPath: string,
  workspacePath: string,
  signal: AbortSignal,
  drawio?: DrawioBackend,
): Promise<void> {
  if (drawio === undefined) {
    throw new Error('Draw.io executable is not configured. Set graphics-workbench.execPath.drawio.');
  }
  signal.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal.throwIfAborted();

  await drawio.runDrawio(drawio.drawioPath, ['-x', '-f', 'pdf', '-o', outputPath, sourcePath], signal);
}

async function writeRasterImageAsPdf({
  sourcePath,
  outputPath,
  workspacePath,
  signal,
  maxInputPixels,
  framePage,
}: WriteRasterImageAsPdfOptions): Promise<void> {
  signal.throwIfAborted();
  const metadataImage = openRasterInput(sourcePath, maxInputPixels, framePage);
  let width: number;
  let height: number;

  try {
    signal.throwIfAborted();
    const metadata = await metadataImage.metadata();
    signal.throwIfAborted();

    if (!metadata.width || !metadata.height) {
      throw new Error(`Could not determine image dimensions: ${sourcePath}`);
    }

    ({ width, height } = metadata);
  } catch (error) {
    signal.throwIfAborted();
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await closeRasterPipeline(metadataImage);
    signal.throwIfAborted();
  }

  const encodingImage = openRasterInput(sourcePath, maxInputPixels, framePage);
  let imageBuffer: Buffer;
  try {
    signal.throwIfAborted();
    imageBuffer = await encodingImage.png().toBuffer();
    signal.throwIfAborted();
  } catch (error) {
    signal.throwIfAborted();
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(maxInputPixels, { width, height }), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await closeRasterPipeline(encodingImage);
    signal.throwIfAborted();
  }

  const mupdf = await loadMupdf();
  const doc = new mupdf.PDFDocument();
  let pdfBytes: Uint8Array;
  try {
    const image = new mupdf.Image(imageBuffer);
    try {
      const imageRef = doc.addImage(image);
      const page = doc.newDictionary();
      page.put('Type', doc.newName('Page'));
      page.put('MediaBox', [0, 0, width, height]);
      const resources = doc.newDictionary();
      const xobject = doc.newDictionary();
      xobject.put('Im0', imageRef);
      resources.put('XObject', xobject);
      page.put('Resources', resources);
      const content = doc.addStream(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`, null);
      page.put('Contents', content);
      doc.insertPage(0, doc.addObject(page));
      // ponytail: doc.addPage(...) is broken in mupdf.js; build the page dict and insertPage instead.
      pdfBytes = savePdfDocument(doc);
    } finally {
      image.destroy();
    }
  } finally {
    doc.destroy();
  }
  signal.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal.throwIfAborted();
  await writeFile(outputPath, pdfBytes);
}

async function writeAnimatedRasterAsPdf(options: {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal: AbortSignal;
  maxInputPixels: number;
  animation: RasterAnimationMetadata;
}): Promise<void> {
  const { sourcePath, outputPath, workspacePath, signal, maxInputPixels, animation } = options;

  // フレームPDFは最終出力と同じstagingディレクトリへ置く。workspace外（os.tmpdir）へ
  // 書くとassertWritablePathInWorkspaceが失敗するため。
  const frameDirectory = path.dirname(outputPath);
  const framePdfPaths: string[] = [];

  try {
    for (let frame = 1; frame <= animation.pages; frame += 1) {
      signal.throwIfAborted();
      const framePdfPath = path.join(frameDirectory, `.graphics-workbench-frame-${frame}.pdf`);
      await writeRasterImageAsPdf({
        sourcePath,
        outputPath: framePdfPath,
        workspacePath,
        signal,
        maxInputPixels,
        framePage: frame,
      });
      framePdfPaths.push(framePdfPath);
    }

    signal.throwIfAborted();
    const mupdf = await loadMupdf();
    const mergedDocument = new mupdf.PDFDocument();
    try {
      for (const framePdfPath of framePdfPaths) {
        signal.throwIfAborted();
        await graftPdfPagesInto(mergedDocument, framePdfPath, signal);
      }
      signal.throwIfAborted();
      await assertWritablePathInWorkspace(outputPath, workspacePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      signal.throwIfAborted();
      await writeFile(outputPath, savePdfDocument(mergedDocument));
    } finally {
      mergedDocument.destroy();
    }
  } finally {
    await removeFramePdfs(framePdfPaths);
  }
}

async function removeFramePdfs(framePdfPaths: readonly string[]): Promise<void> {
  await Promise.all(
    framePdfPaths.map(async (framePdfPath) => rm(framePdfPath, { force: true, maxRetries: 20, retryDelay: 200 })),
  );
}

async function graftPdfPagesInto(
  mergedDocument: MupdfPdfDocumentInstance,
  sourcePdfPath: string,
  signal: AbortSignal,
): Promise<void> {
  const sourceDocument = await openPdfDocument(await readFile(sourcePdfPath));
  try {
    const pageCount = sourceDocument.countPages();
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      signal.throwIfAborted();
      mergedDocument.graftPage(mergedDocument.countPages(), sourceDocument, pageIndex);
    }
  } finally {
    sourceDocument.destroy();
  }
}

async function writeSvgAsPdf({
  sourcePath,
  outputPath,
  workspacePath,
  signal,
  svgToPdf,
  scratchOptions,
}: WriteSvgAsPdfOptions): Promise<void> {
  if (svgToPdf === undefined) {
    throw new Error('SVG-to-PDF backend is not configured.');
  }

  const options = svgToPdf;
  const size = await readSvgSize(sourcePath);
  validateSvgToPdfOptions(options);

  signal.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal.throwIfAborted();

  await (options.engine === 'rsvg-convert'
    ? writeSvgAsPdfWithRsvgConvert(sourcePath, outputPath, options, scratchOptions, signal)
    : writeSvgAsPdfWithChrome(sourcePath, outputPath, options, signal));

  signal.throwIfAborted();
  await normalizePdfPageSize(outputPath, size.width, size.height);
}

async function readSvgSize(sourcePath: string): Promise<{ width: number; height: number }> {
  const sourceBuffer = await readFile(sourcePath);
  const metadata = await sharp(sourceBuffer).metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error(`Could not determine SVG dimensions: ${sourcePath}`);
  }

  return { width, height };
}

async function writeSvgAsPdfWithRsvgConvert(
  sourcePath: string,
  outputPath: string,
  options: SvgToPdfBackend,
  scratchOptions: RsvgToolScratchOptions,
  signal: AbortSignal,
): Promise<void> {
  await runRsvgConvertWithAsciiScratch({
    executable: options.rsvgConvertPath,
    sourcePath,
    outputPath,
    run: options.runRsvgConvert,
    scratch: scratchOptions,
    signal,
  });
}

export async function executeRsvgConvert(executable: string, args: string[], signal: AbortSignal): Promise<void> {
  await runExternalTool({
    toolId: 'rsvgConvert',
    toolName: 'rsvg-convert',
    executable,
    args,
    signal,
  });
}

async function writeSvgAsPdfWithChrome(
  sourcePath: string,
  outputPath: string,
  options: SvgToPdfBackend,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await options.runChrome(
    options.chromePath,
    ['--headless', '--no-pdf-header-footer', `--print-to-pdf=${outputPath}`, pathToFileURL(sourcePath).href],
    signal,
  );
}

export async function executeChrome(executable: string, args: string[], signal: AbortSignal): Promise<void> {
  await runExternalTool({
    toolName: 'chrome',
    executable,
    args,
    signal,
  });
}

export async function validateGeneratedPdf(outputPath: string): Promise<void> {
  let pdfDocument: MupdfPdfDocumentInstance;

  try {
    pdfDocument = await openPdfDocument(await readFile(outputPath));
  } catch (error) {
    throw new Error(`PDF input produced an unparsable PDF: ${toErrorMessage(error)}`, { cause: error });
  }

  try {
    const pageCount = pdfDocument.countPages();
    if (pageCount === 0) {
      throw new Error(`PDF input produced no pages: ${outputPath}`);
    }

    // oxlint-disable-next-line no-unreachable-loop -- Validate every generated page.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = pdfDocument.loadPage(pageIndex);
      try {
        for (const boxName of ['MediaBox', 'CropBox', 'TrimBox'] as const) {
          const [x1, y1, x2, y2] = page.getBounds(boxName);
          const width = x2 - x1;
          const height = y2 - y1;
          // oxlint-disable-next-line max-depth -- Page, box, and dimension validation are one ownership scope.
          if (![x1, y1, x2, y2, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
            throw new Error(`PDF input produced invalid ${boxName} dimensions: ${outputPath}`);
          }
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    pdfDocument.destroy();
  }
}

async function normalizePdfPageSize(outputPath: string, width: number, height: number): Promise<void> {
  const pdfDocument = await openPdfDocument(await readFile(outputPath));
  try {
    if (pdfDocument.countPages() === 0) {
      throw new Error(`Generated PDF has no pages: ${outputPath}`);
    }

    const page = pdfDocument.loadPage(0);
    try {
      setPageSize(page, width, height);
    } finally {
      page.destroy();
    }
    const pdfBytes = savePdfDocument(pdfDocument);
    await writeFile(outputPath, pdfBytes);
  } finally {
    pdfDocument.destroy();
  }
}

function setPageSize(page: MupdfPdfPage, width: number, height: number): void {
  page.setPageBox('MediaBox', [0, 0, width, height]);
  page.setPageBox('CropBox', [0, 0, width, height]);
}

function validateConversions(inputs: PdfInput[]): void {
  if (inputs.length === 0) {
    throw new Error('No image files were selected.');
  }

  for (const input of inputs) {
    if (isSameSourceFormat(input.sourcePath, '.pdf')) {
      throw new Error(`Input and output formats must differ: ${input.sourcePath}`);
    }

    if (!isSupportedPdfConversionSource(input.sourcePath)) {
      throw new Error(`Unsupported image format: ${input.sourcePath}`);
    }
  }
}
