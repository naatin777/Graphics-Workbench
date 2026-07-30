import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PDFDocument } from 'pdf-lib';

import { calculateRgbaDifference, readRgbaPixels } from './raster_content.js';

const execFileAsync = promisify(execFile);

export async function assertRasterMatches(actualPath: string, expectedPath: string, label: string): Promise<void> {
  const actual = await readRgbaPixels(actualPath);
  const expected = await readRgbaPixels(expectedPath);
  const difference = calculateRgbaDifference(expected, actual);

  assert.strictEqual(actual.width, expected.width, label);
  assert.strictEqual(actual.height, expected.height, label);
  assert.ok(difference.differentPixelRatio <= 0.01, label);
  assert.ok(difference.meanChannelDifference <= 1, label);
}

export async function assertPdfMatches(
  actualPath: string,
  expectedPath: string,
  renderDirectory: string,
  label: string,
): Promise<void> {
  const [actual, expected] = await Promise.all([
    PDFDocument.load(await readFile(actualPath)),
    PDFDocument.load(await readFile(expectedPath)),
  ]);
  assert.strictEqual(actual.getPageCount(), expected.getPageCount(), label);

  await mkdir(renderDirectory, { recursive: true });
  for (let page = 1; page <= actual.getPageCount(); page += 1) {
    const actualPagePath = path.join(renderDirectory, `actual-${page}.png`);
    const expectedPagePath = path.join(renderDirectory, `expected-${page}.png`);
    assert.deepStrictEqual(
      actual.getPage(page - 1)?.getSize(),
      expected.getPage(page - 1)?.getSize(),
      `${label} page ${page}`,
    );
    await renderPdfPage(actualPath, actualPagePath, page);
    await renderPdfPage(expectedPath, expectedPagePath, page);
    await assertRasterMatches(actualPagePath, expectedPagePath, `${label} page ${page}`);
  }
}

async function renderPdfPage(sourcePath: string, outputPath: string, page: number): Promise<void> {
  const outputPrefix = outputPath.slice(0, -path.extname(outputPath).length);
  await execFileAsync('pdftocairo', [
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
