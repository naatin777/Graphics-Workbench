import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { toErrorMessage, isAbortError } from '../../shared/error.js';
import {
  loadMupdf,
  openPdfDocument,
  savePdfDocument,
  type MupdfPdfDocumentInstance,
  type MupdfPdfPage,
} from '../pdf/mupdf.js';

import {
  isEditableDrawioImagePath,
  isMermaidPath,
  isRasterImagePath,
  isSameSourceFormat,
} from '../../shared/source_format.js';
import { getDefaultConfiguration } from '../../generated/extension_manifest.js';
import {
  closeRasterPipeline,
  isRasterInputPixelLimitError,
  openRasterInput,
  readRasterAnimationMetadata,
  formatRasterInputPixelLimitMessage,
  type RasterAnimationMetadata,
} from './raster_input.js';

import { assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { validatePdfJobPaths } from '../pdf/pdf_job_paths.js';

import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';
import { runMermaidCliWithSignal } from './tools/run_mermaid_cli.js';
import {
  runRsvgConvertWithAsciiScratch,
  type RsvgToolScratchOptions,
} from '../external_tools/run_rsvg_convert_with_ascii_scratch.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { executeDrawio, type DrawioBackend } from './tools/drawio_tools.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import type { SvgToPdfBackend } from './tools/svg_to_pdf_tools.js';

const defaultSupportedImageExtensions = ['.png'] as const;
const svgExtension = '.svg';

export function validateSvgToPdfOptions(options: SvgToPdfBackend): void {
  if (options.engine === 'chrome' && options.chromePath === '') {
    throw new Error('Chrome executable is not configured. Set graphics-workbench.execPath.chrome.');
  }
}

export interface ConvertToPdfJob {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
}

export interface WriteSourceAsPdfOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal?: AbortSignal;
  maxInputPixels?: number;
  page?: number;
  tools?: {
    svgToPdfTools?: SvgToPdfBackend;
    mermaidTools?: MermaidBackend;
    drawioTools?: DrawioBackend;
  };
  scratchOptions?: RsvgToolScratchOptions;
}

interface StageSourceToPdfOptions {
  signal: AbortSignal | undefined;
  svgToPdfTools: SvgToPdfBackend | undefined;
  mermaidTools: MermaidBackend | undefined;
  drawioTools: DrawioBackend | undefined;
  scratchOptions: RsvgToolScratchOptions;
  maxInputPixels: number | undefined;
}

interface WriteRasterImageAsPdfOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal: AbortSignal | undefined;
  maxInputPixels: number;
  framePage: number | undefined;
}

interface WriteSvgAsPdfOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal: AbortSignal | undefined;
  svgToPdf: SvgToPdfBackend | undefined;
  scratchOptions: RsvgToolScratchOptions;
}

export interface ConvertToPdfFilesOptions {
  jobs: ConvertToPdfJob[];
  runtime?: ConversionExecutionContext;
  runId?: string;
  supportedExtensions?: readonly string[];
  tools?: {
    svgToPdfTools?: SvgToPdfBackend;
    mermaidTools?: MermaidBackend;
    drawioTools?: DrawioBackend;
  };
  platform?: NodeJS.Platform;
  maxInputPixels?: number;
  scratchBaseCandidates?: readonly string[];
  operationName?: string;
}

export async function convertToPdfFiles(options: ConvertToPdfFilesOptions): Promise<CommittedConversionOutput[]> {
  const { runtime } = options;
  const maxInputPixels = options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels();
  runtime?.signal?.throwIfAborted();
  validateJobs(options.jobs, options.supportedExtensions ?? defaultSupportedImageExtensions);
  await validatePdfJobPaths(options.jobs, 'convert-png-to-pdf');
  runtime?.signal?.throwIfAborted();

  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? createRunId();
  const platform = options.platform ?? process.platform;
  const scratchOptions: RsvgToolScratchOptions = { platform };
  if (runtime?.outputChannel !== undefined) {
    scratchOptions.outputChannel = runtime.outputChannel;
  }
  if (options.scratchBaseCandidates !== undefined) {
    scratchOptions.scratchBaseCandidates = options.scratchBaseCandidates;
  }
  const operationName = options.operationName ?? 'convert-png-to-pdf';

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName,
    stagingOperationName: 'convert-png-to-pdf',
    runId,
    runtime: runtime ?? {},
    stage: async (job, index, currentRunId, batchRuntime) =>
      stageSourceToPdf(job, index, currentRunId, {
        signal: batchRuntime.signal,
        svgToPdfTools: options.tools?.svgToPdfTools,
        mermaidTools: options.tools?.mermaidTools,
        drawioTools: options.tools?.drawioTools,
        scratchOptions,
        maxInputPixels,
      }),
  });
}

async function stageSourceToPdf(
  job: ConvertToPdfJob,
  index: number,
  runId: string,
  options: StageSourceToPdfOptions,
): Promise<PreparedConversionOutput> {
  const { signal, svgToPdfTools, mermaidTools, drawioTools, scratchOptions, maxInputPixels } = options;
  signal?.throwIfAborted();
  const stagedOutputPath = path.join(
    job.workspacePath,
    '.graphics-workbench',
    'convert-png-to-pdf',
    runId,
    `${index + 1}`,
    'result.pdf',
  );
  const stagingRootPath = createStagingRoot(job.workspacePath, 'convert-png-to-pdf', runId);

  const writeOptions: WriteSourceAsPdfOptions = {
    sourcePath: job.sourcePath,
    outputPath: stagedOutputPath,
    workspacePath: job.workspacePath,
    scratchOptions,
  };
  if (maxInputPixels !== undefined) {
    writeOptions.maxInputPixels = maxInputPixels;
  }
  if (job.page !== undefined) {
    writeOptions.page = job.page;
  }
  if (signal !== undefined) {
    writeOptions.signal = signal;
  }
  if (svgToPdfTools !== undefined) {
    writeOptions.tools = { ...writeOptions.tools, svgToPdfTools };
  }
  if (mermaidTools !== undefined) {
    writeOptions.tools = { ...writeOptions.tools, mermaidTools };
  }
  if (drawioTools !== undefined) {
    writeOptions.tools = { ...writeOptions.tools, drawioTools };
  }
  await writeSourceAsPdf(writeOptions);
  signal?.throwIfAborted();
  await validateGeneratedPdf(stagedOutputPath);
  signal?.throwIfAborted();

  return {
    stagedOutputPath,
    outputPath: job.outputPath,
    workspacePath: job.workspacePath,
    stagingRootPath,
  };
}

async function readRasterAnimationMetadataSafely(
  sourcePath: string,
  maxInputPixels: number,
): Promise<RasterAnimationMetadata | undefined> {
  try {
    return await readRasterAnimationMetadata(sourcePath, maxInputPixels);
  } catch {
    // ponytail: libvips cannot animate multi-page TIFFs whose pages differ; fall back to the first frame/page.
    return undefined;
  }
}

export async function writeSourceAsPdf(options: WriteSourceAsPdfOptions): Promise<void> {
  const { sourcePath, outputPath, workspacePath, signal, maxInputPixels, tools, scratchOptions = {} } = options;
  const { svgToPdfTools, mermaidTools, drawioTools } = tools ?? {};
  const extension = path.extname(sourcePath).toLowerCase();

  if (options.page === undefined && isRasterImagePath(sourcePath)) {
    const animation = await readRasterAnimationMetadataSafely(
      sourcePath,
      maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels(),
    );
    if (animation !== undefined) {
      await writeSourceAsPdf({ ...options, page: 1 });
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

  if (isMermaidPath(sourcePath)) {
    await writeMermaidAsPdf(sourcePath, outputPath, workspacePath, signal, mermaidTools);
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
    maxInputPixels: maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels(),
    framePage: options.page,
  });
}

async function writeDrawioAsPdf(
  sourcePath: string,
  outputPath: string,
  workspacePath: string,
  signal?: AbortSignal,
  drawio?: DrawioBackend,
): Promise<void> {
  if (drawio === undefined) {
    throw new Error('Draw.io executable is not configured. Set graphics-workbench.execPath.drawio.');
  }
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  await (drawio.runDrawio ?? executeDrawio)(
    drawio.drawioPath,
    ['-x', '-f', 'pdf', '-o', outputPath, sourcePath],
    signal,
  );
}

async function writeMermaidAsPdf(
  sourcePath: string,
  outputPath: string,
  workspacePath: string,
  signal?: AbortSignal,
  mermaid?: MermaidBackend,
): Promise<void> {
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  try {
    await runMermaidCliWithSignal(
      {
        sourcePath,
        outputPath: asPdfOutputPath(outputPath),
        outputFormat: 'pdf',
        mermaidPath: mermaid?.mermaidPath ?? '',
        chromePath: mermaid?.chromePath ?? '',
        theme: mermaid?.theme ?? 'default',
        backgroundColor: mermaid?.backgroundColor ?? 'white',
      },
      signal,
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`Mermaid CLI failed: ${toErrorMessage(error)}`, { cause: error });
  }
}

function asPdfOutputPath(outputPath: string): `${string}.pdf` {
  if (!isPdfOutputPath(outputPath)) {
    throw new Error(`Mermaid PDF output path must end with .pdf: ${outputPath}`);
  }

  return outputPath;
}

function isPdfOutputPath(outputPath: string): outputPath is `${string}.pdf` {
  return outputPath.toLowerCase().endsWith('.pdf');
}

async function writeRasterImageAsPdf({
  sourcePath,
  outputPath,
  workspacePath,
  signal,
  maxInputPixels,
  framePage,
}: WriteRasterImageAsPdfOptions): Promise<void> {
  signal?.throwIfAborted();
  const metadataImage = openRasterInput(sourcePath, maxInputPixels, framePage);
  let width: number;
  let height: number;

  try {
    signal?.throwIfAborted();
    const metadata = await metadataImage.metadata();
    signal?.throwIfAborted();

    if (!metadata.width || !metadata.height) {
      throw new Error(`Could not determine image dimensions: ${sourcePath}`);
    }

    ({ width, height } = metadata);
  } catch (error) {
    signal?.throwIfAborted();
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await closeRasterPipeline(metadataImage);
    signal?.throwIfAborted();
  }

  const encodingImage = openRasterInput(sourcePath, maxInputPixels, framePage);
  let imageBuffer: Buffer;
  try {
    signal?.throwIfAborted();
    imageBuffer = await encodingImage.png().toBuffer();
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(formatRasterInputPixelLimitMessage(maxInputPixels, { width, height }), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await closeRasterPipeline(encodingImage);
    signal?.throwIfAborted();
  }

  const mupdf = await loadMupdf();
  const doc = new mupdf.PDFDocument();
  const image = new mupdf.Image(imageBuffer);
  const imageRef = doc.addImage(image);
  image.destroy();
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
  const pdfBytes = savePdfDocument(doc);
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();
  await writeFile(outputPath, pdfBytes);
}

async function writeSvgAsPdf({
  sourcePath,
  outputPath,
  workspacePath,
  signal,
  svgToPdf,
  scratchOptions,
}: WriteSvgAsPdfOptions): Promise<void> {
  const options = svgToPdf ?? {
    engine: 'chrome',
    rsvgConvertPath: 'rsvg-convert',
    chromePath: '',
  };
  const size = await readSvgSize(sourcePath);
  validateSvgToPdfOptions(options);

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  await (options.engine === 'rsvg-convert'
    ? writeSvgAsPdfWithRsvgConvert(sourcePath, outputPath, options, scratchOptions, signal)
    : writeSvgAsPdfWithChrome(sourcePath, outputPath, options, signal));

  signal?.throwIfAborted();
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
  signal?: AbortSignal,
): Promise<void> {
  await runRsvgConvertWithAsciiScratch({
    executable: options.rsvgConvertPath,
    sourcePath,
    outputPath,
    run: options.runRsvgConvert ?? executeRsvgConvert,
    scratch: scratchOptions,
    ...(signal !== undefined && { signal }),
  });
}

async function executeRsvgConvert(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  await runExternalTool({
    toolName: 'rsvg-convert',
    executable,
    args,
    ...(signal === undefined ? {} : { signal }),
  });
}

async function writeSvgAsPdfWithChrome(
  sourcePath: string,
  outputPath: string,
  options: SvgToPdfBackend,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await (options.runChrome ?? executeChrome)(
    options.chromePath,
    ['--headless', '--no-pdf-header-footer', `--print-to-pdf=${outputPath}`, pathToFileURL(sourcePath).href],
    signal,
  );
}

async function executeChrome(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  await runExternalTool({
    toolName: 'chrome',
    executable,
    args,
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function validateGeneratedPdf(outputPath: string): Promise<void> {
  let pdfDocument: MupdfPdfDocumentInstance;

  try {
    pdfDocument = await openPdfDocument(await readFile(outputPath));
  } catch (error) {
    throw new Error(`PDF conversion produced an unparsable PDF: ${toErrorMessage(error)}`, { cause: error });
  }

  try {
    const pageCount = pdfDocument.countPages();
    if (pageCount === 0) {
      throw new Error(`PDF conversion produced no pages: ${outputPath}`);
    }

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = pdfDocument.loadPage(pageIndex);
      for (const boxName of ['MediaBox', 'CropBox', 'TrimBox'] as const) {
        const [x1, y1, x2, y2] = page.getBounds(boxName);
        const width = x2 - x1;
        const height = y2 - y1;
        if (![x1, y1, x2, y2, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
          throw new Error(`PDF conversion produced invalid ${boxName} dimensions: ${outputPath}`);
        }
      }
    }
  } finally {
    pdfDocument.destroy();
  }
}

async function normalizePdfPageSize(outputPath: string, width: number, height: number): Promise<void> {
  const pdfDocument = await openPdfDocument(await readFile(outputPath));
  if (pdfDocument.countPages() === 0) {
    pdfDocument.destroy();
    throw new Error(`Generated PDF has no pages: ${outputPath}`);
  }

  setPageSize(pdfDocument.loadPage(0), width, height);
  const pdfBytes = savePdfDocument(pdfDocument);
  await writeFile(outputPath, pdfBytes);
}

function setPageSize(page: MupdfPdfPage, width: number, height: number): void {
  page.setPageBox('MediaBox', [0, 0, width, height]);
  page.setPageBox('CropBox', [0, 0, width, height]);
}

function validateJobs(jobs: ConvertToPdfJob[], supportedExtensions: readonly string[]): void {
  if (jobs.length === 0) {
    throw new Error('No image files were selected.');
  }

  const supportedExtensionSet = new Set(supportedExtensions.map((extension) => extension.toLowerCase()));

  for (const job of jobs) {
    if (isSameSourceFormat(job.sourcePath, '.pdf')) {
      throw new Error(`Input and output formats must differ: ${job.sourcePath}`);
    }

    if (!isSupportedSourcePath(job.sourcePath, supportedExtensionSet)) {
      throw new Error(`Unsupported image format: ${job.sourcePath}`);
    }
  }
}

function isSupportedSourcePath(sourcePath: string, supportedExtensionSet: Set<string>): boolean {
  const lowerSourcePath = sourcePath.toLowerCase();
  return [...supportedExtensionSet].some((extension) => lowerSourcePath.endsWith(extension));
}
