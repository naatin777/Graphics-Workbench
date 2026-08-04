import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { Parser } from 'xml2js';
import sharp from 'sharp';

import { isMermaidPath } from '../../application/policy/source_format.js';
import { getDefaultConfiguration } from '../../generated/extension_manifest.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { createRunId, createStagingRoot } from '../lifecycle/run_id.js';
import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import { destroyRasterInput, openRasterInput } from './raster_input.js';
import type { MermaidBackend } from './tools/mermaid_tools.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';
import { runMermaidCliWithSignal } from './tools/run_mermaid_cli.js';
import type { ChromeReleaseChannel } from 'puppeteer-core';

interface DrawioInput {
  sourcePath: string;
  pageName?: string;
}

export interface ConvertToDrawioJob {
  inputs: DrawioInput[];
  outputPath: string;
  workspacePath: string;
}

type RunPdfToSvg = (sourcePath: string, outputPath: string, page: number, signal?: AbortSignal) => Promise<void>;
type RunGhostscript = (executable: string, args: string[], signal?: AbortSignal) => Promise<void>;
type RunMermaid = (sourcePath: string, outputPath: string, signal?: AbortSignal) => Promise<void>;
type RunDrawio = (
  executable: string,
  args: string[],
  signal?: AbortSignal,
  outputChannel?: ConversionExecutionContext['outputChannel'],
) => Promise<void>;

export interface ConvertToDrawioOptions {
  jobs: ConvertToDrawioJob[];
  tools: {
    pdftocairoPath?: string;
    ghostscriptPath: string;
    mermaidTools?: MermaidBackend;
    drawioPath: string;
    runPdfToSvg?: RunPdfToSvg;
    runGhostscript?: RunGhostscript;
    runMermaid?: RunMermaid;
    runDrawio?: RunDrawio;
  };
  runtime?: ConversionExecutionContext;
  runId?: string;
  maxInputPixels?: number;
}

export async function convertToDrawioFiles(options: ConvertToDrawioOptions): Promise<CommittedConversionOutput[]> {
  if (options.jobs.length === 0) {
    throw new Error('No files were selected.');
  }
  for (const job of options.jobs) {
    if (job.inputs.length === 0) {
      throw new Error('No Draw.io inputs were selected.');
    }
    await Promise.all([
      ...job.inputs.map(async (input) => assertExistingPathInWorkspace(input.sourcePath, job.workspacePath)),
      assertWritablePathInWorkspace(job.outputPath, job.workspacePath),
      assertWritablePathInWorkspace(
        path.join(job.workspacePath, '.graphics-workbench', 'convert-to-drawio'),
        job.workspacePath,
      ),
    ]);
  }

  await assertPreflightPassed(preflightOptionsFromRuntime(options.runtime));
  const runId = options.runId ?? createRunId();

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'convert-to-drawio',
    runId,
    runtime: options.runtime ?? {},
    stage: async (job, _index, currentRunId, runtime) => stageDrawio(job, currentRunId, runtime, options),
  });
}

async function stageDrawio(
  job: ConvertToDrawioJob,
  runId: string,
  runtime: ConversionExecutionContext,
  options: ConvertToDrawioOptions,
): Promise<PreparedConversionOutput> {
  const stagingRootPath = createStagingRoot(job.workspacePath, 'convert-to-drawio', runId);
  const stageDirectory = path.join(stagingRootPath, 'inputs');
  const stagedOutputPath = path.join(stagingRootPath, `result${drawioExtension(job.outputPath)}`);
  await assertWritablePathInWorkspace(stagingRootPath, job.workspacePath);
  await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
  await mkdir(stageDirectory, { recursive: true });
  const pages: DrawioPage[] = [];

  for (const [inputIndex, input] of job.inputs.entries()) {
    pages.push(...(await stageDrawioInput(input, inputIndex, stageDirectory, runtime, options)));
  }

  const xml = createDrawioXml(pages);
  await validateDrawioXml(xml, job.inputs[0]?.sourcePath ?? job.outputPath);
  const xmlPath = path.join(stagingRootPath, 'source.drawio');
  await writeFile(xmlPath, xml);
  await (drawioExtension(job.outputPath) === '.drawio'
    ? writeFile(stagedOutputPath, xml)
    : exportEditableDrawioImage({
        xmlPath,
        outputPath: stagedOutputPath,
        workspacePath: job.workspacePath,
        format: drawioExtension(job.outputPath).slice(1),
        drawioPath: options.tools.drawioPath,
        ...(options.tools.runDrawio !== undefined && { runDrawio: options.tools.runDrawio }),
        runtime,
      }));
  if (drawioExtension(job.outputPath) !== '.drawio') {
    await validateEmbeddedDrawioImage(
      stagedOutputPath,
      drawioExtension(job.outputPath),
      job.inputs[0]?.sourcePath ?? job.outputPath,
    );
  }
  await assertExistingPathInWorkspace(stagedOutputPath, job.workspacePath);
  return { stagedOutputPath, outputPath: job.outputPath, workspacePath: job.workspacePath, stagingRootPath };
}

async function stageDrawioInput(
  input: DrawioInput,
  inputIndex: number,
  stageDirectory: string,
  runtime: ConversionExecutionContext,
  options: ConvertToDrawioOptions,
): Promise<DrawioPage[]> {
  runtime.signal?.throwIfAborted();
  const extension = path.extname(input.sourcePath).toLowerCase();
  if (extension === '.pdf') {
    return stagePdfDrawioInput(input, inputIndex, stageDirectory, runtime, options);
  }
  if (extension === '.eps') {
    const pngPath = path.join(stageDirectory, `${inputIndex}.png`);
    await (options.tools.runGhostscript ?? executeGhostscript)(
      options.tools.ghostscriptPath,
      [
        '-dSAFER',
        '-dNOPAUSE',
        '-dBATCH',
        '-dEPSCrop',
        '-sDEVICE=pngalpha',
        '-r144',
        `-sOutputFile=${pngPath}`,
        input.sourcePath,
      ],
      runtime.signal,
    );
    return [
      await rasterPage(pngPath, input, options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels()),
    ];
  }
  if (extension === '.svg') {
    return [await svgPage(input.sourcePath, input)];
  }
  if (isMermaidPath(input.sourcePath)) {
    const svgPath = path.join(stageDirectory, `${inputIndex}.svg`);
    await (
      options.tools.runMermaid ??
      (async (source, output, signal): Promise<void> =>
        executeMermaid(source, output, signal, options.tools.mermaidTools))
    )(input.sourcePath, svgPath, runtime.signal);
    return [await svgPage(svgPath, input)];
  }

  return [
    await rasterPage(
      input.sourcePath,
      input,
      options.maxInputPixels ?? getDefaultConfiguration().raster.maxInputPixels(),
    ),
  ];
}

async function stagePdfDrawioInput(
  input: DrawioInput,
  inputIndex: number,
  stageDirectory: string,
  runtime: ConversionExecutionContext,
  options: ConvertToDrawioOptions,
): Promise<DrawioPage[]> {
  const pdf = await PDFDocument.load(await readFile(input.sourcePath));
  if (pdf.getPageCount() === 0) {
    throw new Error(`PDF has no pages: ${input.sourcePath}`);
  }

  const pages: DrawioPage[] = [];
  for (let page = 1; page <= pdf.getPageCount(); page += 1) {
    runtime.signal?.throwIfAborted();
    const svgPath = path.join(stageDirectory, `${inputIndex}-${page}.svg`);
    await (
      options.tools.runPdfToSvg ??
      (async (source, output, currentPage, signal): Promise<void> =>
        executePdfToSvg(options.tools.pdftocairoPath ?? 'pdftocairo', source, output, currentPage, signal))
    )(input.sourcePath, svgPath, page, runtime.signal);
    pages.push(await svgPage(svgPath, input, page));
  }
  return pages;
}

function drawioExtension(outputPath: string): string {
  const lowerPath = outputPath.toLowerCase();
  if (lowerPath.endsWith('.drawio.png') || lowerPath.endsWith('.dio.png')) {
    return '.png';
  }
  if (lowerPath.endsWith('.drawio.svg') || lowerPath.endsWith('.dio.svg')) {
    return '.svg';
  }
  return '.drawio';
}

async function exportEditableDrawioImage(options: {
  xmlPath: string;
  outputPath: string;
  workspacePath: string;
  format: string;
  drawioPath: string;
  runDrawio?: RunDrawio;
  runtime: ConversionExecutionContext;
}): Promise<void> {
  const args = [
    '--export',
    '--format',
    options.format,
    '--output',
    options.outputPath,
    '--embed-diagram',
    options.xmlPath,
  ];
  await (options.runDrawio ?? executeDrawio)(
    options.drawioPath,
    args,
    options.runtime.signal,
    options.runtime.outputChannel,
  );
  await assertExistingPathInWorkspace(options.outputPath, options.workspacePath);
}

async function validateEmbeddedDrawioImage(outputPath: string, format: string, sourcePath: string): Promise<void> {
  const content = await readFile(outputPath);
  const normalizedFormat = format.replace(/^\./u, '').toLowerCase();
  if (normalizedFormat === 'png') {
    const metadata = await sharp(content).metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
      throw new Error(`Draw.io produced an invalid embedded PNG: ${sourcePath}`);
    }
  } else {
    await validateSvgDocument(content.toString('utf8'), sourcePath);
  }

  if (!content.includes(Buffer.from('mxfile'))) {
    throw new Error(`Draw.io output does not contain an embedded diagram: ${sourcePath}`);
  }
}

async function validateDrawioXml(xml: string, sourcePath: string): Promise<void> {
  try {
    const parsed: unknown = await new Parser().parseStringPromise(xml);
    const mxfile = isRecord(parsed) && isRecord(parsed.mxfile) ? parsed.mxfile : undefined;
    if (!mxfile || !Array.isArray(mxfile.diagram) || mxfile.diagram.length === 0) {
      throw new Error('missing diagram');
    }
  } catch (error) {
    throw new Error(`Draw.io produced invalid XML: ${sourcePath}`, { cause: error });
  }
}

async function validateSvgDocument(content: string, sourcePath: string): Promise<void> {
  try {
    const parsed: unknown = await new Parser().parseStringPromise(content);
    if (typeof parsed !== 'object' || parsed === null || !('svg' in parsed) || parsed.svg === undefined) {
      throw new Error('missing svg root');
    }
  } catch (error) {
    throw new Error(`Draw.io produced invalid embedded SVG: ${sourcePath}`, { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface DrawioPage {
  name: string;
  dataUri: string;
  width: number;
  height: number;
}

async function rasterPage(
  sourcePath: string,
  input: DrawioInput,
  maxInputPixels: number,
  page?: number,
): Promise<DrawioPage> {
  const image = openRasterInput(sourcePath, maxInputPixels, page);
  try {
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`Could not determine image dimensions: ${sourcePath}`);
    }
    const pngBuffer = await image.png().toBuffer();
    const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    return {
      name: input.pageName ?? `${path.basename(sourcePath)}${page === undefined ? '' : `-${page}`}`,
      dataUri,
      width: metadata.width,
      height: metadata.height,
    };
  } finally {
    await destroyRasterInput(image);
  }
}

async function svgPage(sourcePath: string, input: DrawioInput, page?: number): Promise<DrawioPage> {
  const source = await readFile(sourcePath, 'utf8');
  const { width, height } = parseSvgSize(source);
  return {
    name: input.pageName ?? `${path.basename(input.sourcePath)}${page === undefined ? '' : `-${page}`}`,
    dataUri: `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`,
    width,
    height,
  };
}

export function parseSvgSize(source: string): { width: number; height: number } {
  const tag = source.match(/<svg\b[^>]*>/iu)?.[0] ?? '';
  const dimensions = parseSvgDimensions(tag);
  const sized = resolveSvgDimensions(dimensions);
  if (!isUsableSvgDimensions(sized)) {
    throw new Error('SVG has no usable dimensions.');
  }
  return sized;
}

function parseSvgDimensions(tag: string): {
  width: number | undefined;
  height: number | undefined;
  viewBoxWidth: number | undefined;
  viewBoxHeight: number | undefined;
} {
  const width = cssNumber(tag.match(/\bwidth\s*=\s*["']\s*([-+\d.e]+)/iu)?.[1]);
  const height = cssNumber(tag.match(/\bheight\s*=\s*["']\s*([-+\d.e]+)/iu)?.[1]);
  const viewBox = tag.match(/\bviewBox\s*=\s*["']\s*([-+\d.e]+)\s+[-+\d.e]+\s+([-+\d.e]+)\s+([-+\d.e]+)\s*["']/iu);
  return {
    width,
    height,
    viewBoxWidth: cssNumber(viewBox?.[2]),
    viewBoxHeight: cssNumber(viewBox?.[3]),
  };
}

function resolveSvgDimensions(dimensions: ReturnType<typeof parseSvgDimensions>): {
  width: number | undefined;
  height: number | undefined;
} {
  const { width, height, viewBoxWidth, viewBoxHeight } = dimensions;
  const aspectWidth =
    viewBoxWidth !== undefined && viewBoxHeight !== undefined ? viewBoxWidth / viewBoxHeight : undefined;
  return {
    width: width ?? widthFromHeight(height, aspectWidth) ?? viewBoxWidth,
    height: height ?? heightFromWidth(width, aspectWidth) ?? viewBoxHeight,
  };
}

function widthFromHeight(height: number | undefined, aspectWidth: number | undefined): number | undefined {
  return height !== undefined && aspectWidth !== undefined ? height * aspectWidth : undefined;
}

function heightFromWidth(width: number | undefined, aspectWidth: number | undefined): number | undefined {
  return width !== undefined && aspectWidth !== undefined ? width / aspectWidth : undefined;
}

function isUsableSvgDimensions(
  dimensions: ReturnType<typeof resolveSvgDimensions>,
): dimensions is { width: number; height: number } {
  return (
    dimensions.width !== undefined &&
    dimensions.width !== 0 &&
    dimensions.height !== undefined &&
    dimensions.height !== 0 &&
    Number.isFinite(dimensions.width) &&
    Number.isFinite(dimensions.height)
  );
}

function cssNumber(value: string | undefined): number | undefined {
  const number = value === undefined || value === '' ? Number.NaN : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function createDrawioXml(pages: DrawioPage[]): string {
  const used = new Set<string>();
  const diagrams = pages.map((page, index) => {
    const name = uniquePageName(page.name, used);
    const id = `page-${index + 1}`;
    const cellId = `image-${index + 1}`;
    const value = escapeXml(page.dataUri);
    return `<diagram id="${id}" name="${escapeXml(name)}"><mxGraphModel pageWidth="${page.width}" pageHeight="${page.height}"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="${cellId}" style="shape=image;image=${value};imageAspect=0;" vertex="1" parent="1"><mxGeometry width="${page.width}" height="${page.height}" as="geometry"/></mxCell></root></mxGraphModel></diagram>`;
  });
  return `<mxfile host="app.diagrams.net">${diagrams.join('')}</mxfile>`;
}

function uniquePageName(value: string, used: Set<string>): string {
  const base = value.replaceAll(/[\\/:*?"<>|]/g, '_').trim() || 'Page';
  let candidate = base;
  for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function executePdfToSvg(
  executable: string,
  sourcePath: string,
  outputPath: string,
  page: number,
  signal?: AbortSignal,
): Promise<void> {
  await runExternalTool({
    toolName: 'pdftocairo',
    executable,
    args: ['-svg', '-f', String(page), '-l', String(page), sourcePath, outputPath],
    ...(signal === undefined ? {} : { signal }),
  });
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

async function executeGhostscript(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  await runExternalTool({ toolName: 'Ghostscript', executable, args, ...(signal !== undefined && { signal }) });
}

async function executeMermaid(
  sourcePath: string,
  outputPath: string,
  signal: AbortSignal | undefined,
  options?: MermaidBackend,
): Promise<void> {
  signal?.throwIfAborted();
  await runMermaidCliWithSignal(
    {
      sourcePath,
      outputPath: asSvgOutputPath(outputPath),
      outputFormat: 'svg',
      puppeteerConfig: {
        headless: true,
        channel: toChromeReleaseChannel(options?.browserChannel ?? 'chrome'),
        ...(options?.executablePath === undefined || options.executablePath === ''
          ? {}
          : { executablePath: options.executablePath }),
      },
      ...(options === undefined ? {} : { theme: options.theme, backgroundColor: options.backgroundColor }),
    },
    signal,
  );
  signal?.throwIfAborted();
}

function toChromeReleaseChannel(value: string): ChromeReleaseChannel {
  switch (value) {
    case 'chrome':
    case 'chrome-beta':
    case 'chrome-canary':
    case 'chrome-dev': {
      return value;
    }
    default: {
      throw new Error(`Unsupported Mermaid browser channel: ${value}`);
    }
  }
}

function asSvgOutputPath(outputPath: string): `${string}.svg` {
  if (!isSvgOutputPath(outputPath)) {
    throw new Error(`Mermaid SVG output path must end with .svg: ${outputPath}`);
  }

  return outputPath;
}

function isSvgOutputPath(outputPath: string): outputPath is `${string}.svg` {
  return outputPath.toLowerCase().endsWith('.svg');
}
