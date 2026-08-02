import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, type PDFPage } from 'pdf-lib';
import { launch, type Browser, type LaunchOptions, type Page } from 'puppeteer-core';
import sharp from 'sharp';
import { errorMessage, isAbortError } from '../../application/error_utils.js';

import {
  isEditableDrawioImagePath,
  isMermaidPath,
  isRasterImagePath,
  isSameSourceFormat,
} from '../../application/policy/source_format.js';
import { getDefaultConfiguration } from '../../generated-extension-meta.js';
import { convertEpsToPdf } from './eps_to_pdf.js';
import {
  destroyRasterInput,
  isRasterInputPixelLimitError,
  openRasterInput,
  readRasterAnimationMetadata,
  rasterInputPixelLimitMessage,
  type RasterAnimationMetadata,
} from './raster_input.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { validateJobPaths } from '../pdf/pdf_utils.js';

import {
  type CommittedConversionOutput,
  type PreparedConversionOutput,
} from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { createMermaidPuppeteerConfig } from './mermaid_render_options.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';
import { runMermaidCliWithSignal } from './tools/run_mermaid_cli.js';
import {
  runRsvgConvertWithAsciiScratch,
  type RsvgToolScratchOptions,
} from '../external_tools/run_rsvg_convert_with_ascii_scratch.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { OperationCancelledError } from '../lifecycle/operation_cancelled_error.js';
import type { DrawioBackend, MermaidBackend, SvgToPdfBackend } from './tools/index.js';

const defaultSupportedImageExtensions = ['.png'] as const;
const svgExtension = '.svg';

export function validateSvgToPdfOptions(options: SvgToPdfBackend): void {
  if (
    options.engine === 'puppeteer' &&
    options.puppeteerBrowser === 'firefox' &&
    (options.puppeteerExecutablePath === undefined || options.puppeteerExecutablePath === '')
  ) {
    throw new Error('puppeteer.executablePath must be set when puppeteer.browser is firefox.');
  }
}

export function createSvgPuppeteerLaunchOptions(options: SvgToPdfBackend): LaunchOptions {
  validateSvgToPdfOptions(options);
  const executablePath = options.puppeteerExecutablePath;

  return {
    headless: true,
    env: puppeteerLaunchEnv(),
    browser: options.puppeteerBrowser,
    ...(executablePath !== undefined && executablePath !== ''
      ? { executablePath }
      : { channel: options.puppeteerBrowserChannel }),
  };
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
    ghostscriptPath?: string;
  };
  scratchOptions?: RsvgToolScratchOptions;
}

interface StageSourceToPdfOptions {
  signal: AbortSignal | undefined;
  svgToPdfTools: SvgToPdfBackend | undefined;
  mermaidTools: MermaidBackend | undefined;
  drawioTools: DrawioBackend | undefined;
  scratchOptions: RsvgToolScratchOptions;
  ghostscriptPath: string | undefined;
  maxInputPixels: number | undefined;
}

interface WriteEpsAsPdfOptions {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  signal: AbortSignal | undefined;
  ghostscriptPath: string | undefined;
  scratchOptions: RsvgToolScratchOptions;
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
    ghostscriptPath?: string;
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
  await validateJobPaths(options.jobs, 'convert-png-to-pdf');
  runtime?.signal?.throwIfAborted();

  await assertPreflightPassed(preflightOptionsFromRuntime(runtime));
  runtime?.signal?.throwIfAborted();

  const runId = options.runId ?? `${Date.now()}-${crypto.randomUUID()}`;
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
        ghostscriptPath: options.tools?.ghostscriptPath,
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
  const { signal, svgToPdfTools, mermaidTools, drawioTools, scratchOptions, ghostscriptPath, maxInputPixels } = options;
  signal?.throwIfAborted();
  const stagedOutputPath = path.join(
    job.workspacePath,
    '.graphics-workbench',
    'convert-png-to-pdf',
    runId,
    `${index + 1}`,
    'result.pdf',
  );
  const stagingRootPath = path.join(job.workspacePath, '.graphics-workbench', 'convert-png-to-pdf', runId);

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
  if (ghostscriptPath !== undefined) {
    writeOptions.tools = { ...writeOptions.tools, ghostscriptPath };
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
  const { svgToPdfTools, mermaidTools, drawioTools, ghostscriptPath } = tools ?? {};
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

  if (extension === '.eps') {
    await writeEpsAsPdf({ sourcePath, outputPath, workspacePath, signal, ghostscriptPath, scratchOptions });
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
  const resolvedDrawio = drawio ?? { drawioPath: 'drawio' };
  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  await (resolvedDrawio.runDrawio ?? executeDrawio)(
    resolvedDrawio.drawioPath,
    ['-x', '-f', 'pdf', '-o', outputPath, sourcePath],
    signal,
  );
}

async function executeDrawio(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  await runExternalTool({
    toolName: 'drawio',
    executable,
    args,
    ...(signal !== undefined && { signal }),
  });
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
        puppeteerConfig: createMermaidPuppeteerConfig(mermaid),
        theme: mermaid?.theme ?? 'default',
        backgroundColor: mermaid?.backgroundColor ?? 'white',
      },
      signal,
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    throw new Error(`Mermaid CLI failed: ${errorMessage(error)}`, { cause: error });
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

async function writeEpsAsPdf({
  sourcePath,
  outputPath,
  workspacePath,
  signal,
  ghostscriptPath,
  scratchOptions,
}: WriteEpsAsPdfOptions): Promise<void> {
  if (ghostscriptPath === undefined || ghostscriptPath === '') {
    throw new Error('Ghostscript is required for EPS conversion');
  }

  signal?.throwIfAborted();
  const epsStaging = path.join(path.dirname(outputPath), 'eps-staging');
  await mkdir(epsStaging, { recursive: true });
  signal?.throwIfAborted();

  const epsOptions: Parameters<typeof convertEpsToPdf>[0] = {
    epsPath: sourcePath,
    workspacePath,
    stagingDirectory: epsStaging,
    tools: { ghostscriptPath },
  };
  if (signal !== undefined) {
    epsOptions.signal = signal;
  }
  if (scratchOptions.platform !== undefined) {
    epsOptions.platform = scratchOptions.platform;
  }
  if (scratchOptions.scratchBaseCandidates !== undefined) {
    epsOptions.scratchBaseCandidates = scratchOptions.scratchBaseCandidates;
  }
  if (scratchOptions.outputChannel !== undefined) {
    epsOptions.outputChannel = scratchOptions.outputChannel;
  }

  const { pdfPath } = await convertEpsToPdf(epsOptions);

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await readFile(pdfPath));
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

    width = metadata.width;
    height = metadata.height;
  } catch (error) {
    signal?.throwIfAborted();
    if (isRasterInputPixelLimitError(error)) {
      throw new Error(rasterInputPixelLimitMessage(maxInputPixels), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await destroyRasterInput(metadataImage);
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
      throw new Error(rasterInputPixelLimitMessage(maxInputPixels, { width, height }), { cause: error });
    }

    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await destroyRasterInput(encodingImage);
    signal?.throwIfAborted();
  }

  const pdfDocument = await PDFDocument.create();
  const page = pdfDocument.addPage([width, height]);
  const embeddedImage = await pdfDocument.embedPng(imageBuffer);
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width,
    height,
  });

  const pdfBytes = await pdfDocument.save();
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
    engine: 'puppeteer',
    rsvgConvertPath: 'rsvg-convert',
    puppeteerBrowser: 'chrome',
    puppeteerBrowserChannel: 'chrome',
  };
  const size = await readSvgSize(sourcePath);

  signal?.throwIfAborted();
  await assertWritablePathInWorkspace(outputPath, workspacePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  signal?.throwIfAborted();

  await (options.engine === 'rsvg-convert'
    ? writeSvgAsPdfWithRsvgConvert(sourcePath, outputPath, options, scratchOptions, signal)
    : writeSvgAsPdfWithPuppeteer(sourcePath, outputPath, size, options, signal));

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

async function writeSvgAsPdfWithPuppeteer(
  sourcePath: string,
  outputPath: string,
  size: { width: number; height: number },
  options: SvgToPdfBackend,
  signal?: AbortSignal,
): Promise<void> {
  const rawSvg = await readFile(sourcePath, 'utf8');
  const svg = rawSvg.replace(/^<\?xml[^>]*\?>/i, '').trim();
  signal?.throwIfAborted();

  let browser: Browser | undefined;
  let page: Page | undefined;
  let rejectAbort: ((error: Error) => void) | undefined;
  let renderingAborted = false;
  const abortPromise =
    signal === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
          rejectAbort = reject;
        });
  const abort = (): void => {
    renderingAborted = true;
    rejectAbort?.(new OperationCancelledError('SVG PDF rendering was cancelled.'));
    void closePage(page);
    void closeBrowser(browser);
  };
  const isRenderingAborted = (): boolean => renderingAborted || signal?.aborted === true;

  try {
    signal?.addEventListener('abort', abort, { once: true });
    const render = (async (): Promise<void> => {
      try {
        browser = await launch(createSvgPuppeteerLaunchOptions(options));
        if (isRenderingAborted()) {
          throw new OperationCancelledError('SVG PDF rendering was cancelled.');
        }

        page = await browser.newPage();
        if (isRenderingAborted()) {
          throw new OperationCancelledError('SVG PDF rendering was cancelled.');
        }
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          // The SVG is injected as inline content. No network or subframe navigation
          // is required, including requests created from foreignObject content.
          void (async (): Promise<void> => {
            try {
              await request.abort();
            } catch {
              // The request may already be aborted by Puppeteer during page teardown.
            }
          })();
        });
        await page.setContent(svgPageHtml(svg, size), { waitUntil: 'load' });
        signal?.throwIfAborted();
        await page.pdf({
          path: outputPath,
          width: `${size.width / 72}in`,
          height: `${size.height / 72}in`,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          printBackground: true,
          preferCSSPageSize: false,
        });
      } finally {
        // The outer race may have returned before launch/newPage completed. Keep
        // cleanup here so late-arriving handles are closed as well.
        await closePage(page);
        await closeBrowser(browser);
      }
    })();
    await (abortPromise === undefined ? render : Promise.race([render, abortPromise]));
  } finally {
    signal?.removeEventListener('abort', abort);
    await closePage(page);
    await closeBrowser(browser);
  }
}

async function closeBrowser(browser: Browser | undefined): Promise<void> {
  try {
    await browser?.close();
  } catch {
    // Browser cleanup is best effort after PDF generation or cancellation.
  }
}

async function closePage(page: Page | undefined): Promise<void> {
  try {
    await page?.close();
  } catch {
    // Page cleanup is best effort after cancellation.
  }
}

function puppeteerLaunchEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function svgPageHtml(svg: string, size: { width: number; height: number }): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<style>',
    '@page { margin: 0; }',
    `html, body { margin: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; }`,
    'svg { display: block; width: 100%; height: 100%; }',
    '</style>',
    '</head>',
    '<body>',
    svg,
    '</body>',
    '</html>',
  ].join('');
}

export async function validateGeneratedPdf(outputPath: string): Promise<void> {
  let pdfDocument: PDFDocument;

  try {
    pdfDocument = await PDFDocument.load(await readFile(outputPath));
  } catch (error) {
    throw new Error(`PDF conversion produced an unparsable PDF: ${errorMessage(error)}`, { cause: error });
  }

  if (pdfDocument.getPageCount() === 0) {
    throw new Error(`PDF conversion produced no pages: ${outputPath}`);
  }

  for (const page of pdfDocument.getPages()) {
    for (const [boxName, box] of [
      ['MediaBox', page.getMediaBox()],
      ['CropBox', page.getCropBox()],
      ['TrimBox', page.getTrimBox()],
    ] as const) {
      const values = [box.x, box.y, box.width, box.height];
      if (!values.every((value) => Number.isFinite(value)) || box.width <= 0 || box.height <= 0) {
        throw new Error(`PDF conversion produced invalid ${boxName} dimensions: ${outputPath}`);
      }
    }
  }
}

async function normalizePdfPageSize(outputPath: string, width: number, height: number): Promise<void> {
  const pdfDocument = await PDFDocument.load(await readFile(outputPath));
  if (pdfDocument.getPageCount() === 0) {
    throw new Error(`Generated PDF has no pages: ${outputPath}`);
  }

  const firstPage = pdfDocument.getPage(0);
  setPageSize(firstPage, width, height);

  await writeFile(outputPath, await pdfDocument.save());
}

function setPageSize(page: PDFPage, width: number, height: number): void {
  page.setMediaBox(0, 0, width, height);
  page.setCropBox(0, 0, width, height);
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
