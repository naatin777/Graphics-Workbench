import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PDFDocument } from 'pdf-lib';

import { readPdftocairoExecutablePath } from '../../src/config/external_tools/external_tool_paths.js';
import { getExtensionConfiguration } from '../../src/generated-extension-config.js';
import {
  calculateRgbaDifference,
  readNormalizedRgbaPixels,
  readRgbaPixels,
  type RasterComparisonOptions,
} from './raster_content.js';

const execFileAsync = promisify(execFile);

export async function assertRasterMatches(
  actualPath: string,
  expectedPath: string,
  label: string,
  options: RasterComparisonOptions = {},
): Promise<void> {
  const [actual, expected] = options.rendererVariance
    ? await Promise.all([readNormalizedRgbaPixels(actualPath), readNormalizedRgbaPixels(expectedPath)])
    : await Promise.all([readRgbaPixels(actualPath), readRgbaPixels(expectedPath)]);
  const difference = calculateRgbaDifference(expected, actual);

  if (options.rendererVariance) {
    const actualOriginal = await readRgbaPixels(actualPath);
    const expectedOriginal = await readRgbaPixels(expectedPath);
    assert.ok(
      Math.abs(actualOriginal.width / expectedOriginal.width - 1) <= 0.05,
      `${label}: renderer output width differs by more than 5%`,
    );
    assert.ok(
      Math.abs(actualOriginal.height / expectedOriginal.height - 1) <= 0.05,
      `${label}: renderer output height differs by more than 5%`,
    );
  } else {
    assert.strictEqual(actual.width, expected.width, label);
    assert.strictEqual(actual.height, expected.height, label);
  }
  assert.ok(
    difference.differentPixelRatio <= (options.rendererVariance ? 0.08 : 0.01),
    `${label}: differentPixelRatio=${difference.differentPixelRatio}`,
  );
  assert.ok(
    difference.meanChannelDifference <= (options.rendererVariance ? 4 : 1),
    `${label}: meanChannelDifference=${difference.meanChannelDifference}`,
  );
}

export async function assertSvgStructureMatches(
  actualPath: string,
  expectedPath: string,
  label: string,
): Promise<void> {
  const [actual, expected] = await Promise.all([readFile(actualPath, 'utf8'), readFile(expectedPath, 'utf8')]);
  assert.deepStrictEqual(svgStructureSignature(actual), svgStructureSignature(expected), label);
}

export async function assertPdfMatches(
  actualPath: string,
  expectedPath: string,
  renderDirectory: string,
  label: string,
  options: RasterComparisonOptions = {},
): Promise<void> {
  const [actual, expected] = await Promise.all([
    PDFDocument.load(await readFile(actualPath)),
    PDFDocument.load(await readFile(expectedPath)),
  ]);
  assert.strictEqual(actual.getPageCount(), expected.getPageCount(), label);
  const pdftocairoPath = readPdftocairoExecutablePath(getExtensionConfiguration());
  assert.notStrictEqual(pdftocairoPath, '', 'pdftocairo must be configured in test/vscode-settings/settings.json');

  await mkdir(renderDirectory, { recursive: true });
  for (let page = 1; page <= actual.getPageCount(); page += 1) {
    const actualPagePath = path.join(renderDirectory, `actual-${page}.png`);
    const expectedPagePath = path.join(renderDirectory, `expected-${page}.png`);
    const actualPageSize = actual.getPage(page - 1)?.getSize();
    const expectedPageSize = expected.getPage(page - 1)?.getSize();
    if (options.rendererVariance) {
      assert.ok(actualPageSize !== undefined && expectedPageSize !== undefined, `${label} page ${page}`);
      assert.ok(
        Math.abs(actualPageSize.width / expectedPageSize.width - 1) <= 0.05,
        `${label} page ${page}: renderer output width differs by more than 5%`,
      );
      assert.ok(
        Math.abs(actualPageSize.height / expectedPageSize.height - 1) <= 0.05,
        `${label} page ${page}: renderer output height differs by more than 5%`,
      );
    } else {
      assert.deepStrictEqual(actualPageSize, expectedPageSize, `${label} page ${page}`);
    }
    await renderPdfPage(actualPath, actualPagePath, page, pdftocairoPath);
    await renderPdfPage(expectedPath, expectedPagePath, page, pdftocairoPath);
    await assertRasterMatches(actualPagePath, expectedPagePath, `${label} page ${page}`, options);
  }
}

async function renderPdfPage(
  sourcePath: string,
  outputPath: string,
  page: number,
  pdftocairoPath: string,
): Promise<void> {
  const outputPrefix = outputPath.slice(0, -path.extname(outputPath).length);
  await execFileAsync(pdftocairoPath, [
    '-png',
    '-singlefile',
    '-f',
    String(page),
    '-l',
    String(page),
    sourcePath,
    outputPrefix,
  ]);
}

function svgStructureSignature(serialized: string): {
  elementCounts: Record<string, number>;
  labels: string[];
  dataAttributes: Record<string, string[]>;
} {
  const elementCounts: Record<string, number> = {};
  for (const match of serialized.matchAll(/<(circle|ellipse|line|path|polygon|polyline|rect|text)\b/giu)) {
    const elementName = match[1]?.toLowerCase();
    if (elementName !== undefined) {
      elementCounts[elementName] = (elementCounts[elementName] ?? 0) + 1;
    }
  }

  const labels = [...serialized.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/giu)]
    .map((match) => match[1]?.replaceAll(/<[^>]+>/gu, '').trim())
    .filter((label): label is string => label !== undefined && label !== '')
    .toSorted();
  const dataAttributes: Record<string, string[]> = {};
  for (const attribute of ['data-et', 'data-id', 'data-type']) {
    dataAttributes[attribute] = [...serialized.matchAll(new RegExp(`\\b${attribute}="([^"]*)"`, 'gu'))]
      .map((match) => match[1] ?? '')
      .toSorted();
  }

  return { elementCounts, labels, dataAttributes };
}
