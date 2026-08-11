import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';

import { isMermaidPath } from '@graphics-workbench/core/shared/source_format.js';

import type {
  ConversionExecutionContext,
  ResolvedConversionRuntime,
} from '@graphics-workbench/core/operations/lifecycle/conversion_runtime.js';
import type {
  CommittedConversionOutput,
  PreparedConversionOutput,
} from '@graphics-workbench/core/operations/lifecycle/commit_conversion_outputs.js';
import type { RunDrawio } from '@graphics-workbench/core/operations/conversion/tools/drawio_tools.js';
import type { RunPdfToSvg } from '@graphics-workbench/core/operations/conversion/tools/pdf_render_tools.js';
import { runStagedConversionBatch } from '@graphics-workbench/core/operations/lifecycle/run_staged_conversion_batch.js';
import { stagingRootPathFor } from '@graphics-workbench/core/operations/lifecycle/run_id.js';
import {
  assertExistingPathInWorkspace,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security/workspace_path.js';
import { closeRasterPipeline, openRasterInput } from '@graphics-workbench/core/operations/conversion/raster_input.js';
import { countPdfPages } from '@graphics-workbench/core/operations/pdf/mupdf.js';

interface DrawioSourceInput {
  sourcePath: string;
  pageName?: string;
}

export interface DrawioComposeInput {
  inputs: DrawioSourceInput[];
  outputPath: string;
  workspacePath: string;
}

type RunMermaid = (sourcePath: string, outputPath: string, signal: AbortSignal) => Promise<void>;
export interface ConvertToDrawioOptions {
  inputs: DrawioComposeInput[];
  tools: {
    drawioPath: string;
    runPdfToSvg: RunPdfToSvg;
    runMermaid: RunMermaid;
    runDrawio: RunDrawio;
  };
  runtime?: ConversionExecutionContext;
  runId?: string;
  maxInputPixels: number;
}

export async function convertToDrawioFiles(options: ConvertToDrawioOptions): Promise<CommittedConversionOutput[]> {
  if (options.inputs.length === 0) {
    throw new Error('No files were selected.');
  }
  for (const composeInput of options.inputs) {
    if (composeInput.inputs.length === 0) {
      throw new Error('No Draw.io inputs were selected.');
    }
    await Promise.all([
      ...composeInput.inputs.map(async (sourceInput) =>
        assertExistingPathInWorkspace(sourceInput.sourcePath, composeInput.workspacePath),
      ),
      assertWritablePathInWorkspace(composeInput.outputPath, composeInput.workspacePath),
      assertWritablePathInWorkspace(
        path.join(composeInput.workspacePath, '.graphics-workbench', 'convert-to-drawio'),
        composeInput.workspacePath,
      ),
    ]);
  }

  options.runtime?.signal?.throwIfAborted();
  return runStagedConversionBatch({
    inputs: options.inputs,
    operationName: 'convert-to-drawio',
    runId: options.runId,
    ...(options.runtime !== undefined && { runtime: options.runtime }),
    stage: async (input, _index, currentRunId, runtime) => stageDrawio(input, currentRunId, runtime, options),
  });
}

async function stageDrawio(
  composeInput: DrawioComposeInput,
  runId: string,
  runtime: ResolvedConversionRuntime,
  options: ConvertToDrawioOptions,
): Promise<PreparedConversionOutput> {
  const stagingRootPath = stagingRootPathFor(composeInput.workspacePath, 'convert-to-drawio', runId);
  const stageDirectory = path.join(stagingRootPath, 'inputs');
  const stagedOutputPath = path.join(stagingRootPath, `result${drawioExtension(composeInput.outputPath)}`);
  await assertWritablePathInWorkspace(stagingRootPath, composeInput.workspacePath);
  await assertWritablePathInWorkspace(stagedOutputPath, composeInput.workspacePath);
  await mkdir(stageDirectory, { recursive: true });
  const pages: DrawioPage[] = [];

  for (const [inputIndex, sourceInput] of composeInput.inputs.entries()) {
    pages.push(...(await stageDrawioInput(sourceInput, inputIndex, stageDirectory, runtime, options)));
  }

  const xml = createDrawioXml(pages);
  await validateDrawioXml(xml, composeInput.inputs[0]?.sourcePath ?? composeInput.outputPath);
  const xmlPath = path.join(stagingRootPath, 'source.drawio');
  await writeFile(xmlPath, xml);
  await (drawioExtension(composeInput.outputPath) === '.drawio'
    ? writeFile(stagedOutputPath, xml)
    : exportEditableDrawioImage({
        xmlPath,
        outputPath: stagedOutputPath,
        workspacePath: composeInput.workspacePath,
        format: drawioExtension(composeInput.outputPath).slice(1),
        drawioPath: options.tools.drawioPath,
        runDrawio: options.tools.runDrawio,
        runtime,
      }));
  if (drawioExtension(composeInput.outputPath) !== '.drawio') {
    await validateEmbeddedDrawioImage(
      stagedOutputPath,
      drawioExtension(composeInput.outputPath),
      composeInput.inputs[0]?.sourcePath ?? composeInput.outputPath,
    );
  }
  await assertExistingPathInWorkspace(stagedOutputPath, composeInput.workspacePath);
  return {
    stagedOutputPath,
    outputPath: composeInput.outputPath,
    workspacePath: composeInput.workspacePath,
    stagingRootPath,
  };
}

async function stageDrawioInput(
  input: DrawioSourceInput,
  inputIndex: number,
  stageDirectory: string,
  runtime: ResolvedConversionRuntime,
  options: ConvertToDrawioOptions,
): Promise<DrawioPage[]> {
  runtime.signal.throwIfAborted();
  const extension = path.extname(input.sourcePath).toLowerCase();
  if (extension === '.pdf') {
    return stagePdfDrawioInput(input, inputIndex, stageDirectory, runtime, options);
  }
  if (extension === '.svg') {
    return [await svgPage(input.sourcePath, input)];
  }
  if (isMermaidPath(input.sourcePath)) {
    const svgPath = path.join(stageDirectory, `${inputIndex}.svg`);
    await options.tools.runMermaid(input.sourcePath, svgPath, runtime.signal);
    return [await svgPage(svgPath, input)];
  }

  return [await rasterPage(input.sourcePath, input, options.maxInputPixels)];
}

async function stagePdfDrawioInput(
  input: DrawioSourceInput,
  inputIndex: number,
  stageDirectory: string,
  runtime: ResolvedConversionRuntime,
  options: ConvertToDrawioOptions,
): Promise<DrawioPage[]> {
  const pageCount = await countPdfPages(await readFile(input.sourcePath));
  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${input.sourcePath}`);
  }

  const pages: DrawioPage[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    runtime.signal.throwIfAborted();
    const svgPath = path.join(stageDirectory, `${inputIndex}-${page}.svg`);
    await options.tools.runPdfToSvg(input.sourcePath, svgPath, page, runtime.signal);
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
  runDrawio: RunDrawio;
  runtime: ResolvedConversionRuntime;
}): Promise<void> {
  const args = [
    '--export',
    '--format',
    options.format,
    '--output',
    options.outputPath,
    ...(options.format === 'png' || options.format === 'svg'
      ? ['--embed-diagram', options.xmlPath]
      : [options.xmlPath]),
  ];
  await options.runDrawio(options.drawioPath, args, options.runtime.signal, options.runtime.outputChannel);
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
    // oxlint-disable-next-line typescript/no-restricted-types -- 外部XMLの未検証パース結果。直後のisRecordで検証する境界。
    const parsed: unknown = parseDrawioXml(xml);
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
    // oxlint-disable-next-line typescript/no-restricted-types -- 外部SVG/XMLの未検証パース結果。直後のinチェックで検証する境界。
    const parsed: unknown = new XMLParser({ ignoreAttributes: false }).parse(content);
    if (typeof parsed !== 'object' || parsed === null || !('svg' in parsed) || parsed.svg === undefined) {
      throw new Error('missing svg root');
    }
  } catch (error) {
    throw new Error(`Draw.io produced invalid embedded SVG: ${sourcePath}`, { cause: error });
  }
}

// oxlint-disable-next-line typescript/no-restricted-types -- 外部XMLを検証前に返すパース関数の境界。
function parseDrawioXml(xml: string): unknown {
  return new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'diagram' }).parse(xml);
}

// oxlint-disable-next-line typescript/no-restricted-types -- 型ガード: 外部XML/JS値がオブジェクトか検証する。
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
  input: DrawioSourceInput,
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
    await closeRasterPipeline(image);
  }
}

async function svgPage(sourcePath: string, input: DrawioSourceInput, page?: number): Promise<DrawioPage> {
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
