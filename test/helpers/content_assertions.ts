import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PDFDocument } from 'pdf-lib';

import { readPdftocairoExecutablePath } from '../../src/config/external_tools/external_tool_paths.js';
import { getExtensionConfiguration } from '../../src/generated-extension-config.js';
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
  const pdftocairoPath = readPdftocairoExecutablePath(getExtensionConfiguration());
  assert.notStrictEqual(pdftocairoPath, '', 'pdftocairo must be configured in test/vscode-settings/settings.json');

  await mkdir(renderDirectory, { recursive: true });
  for (let page = 1; page <= actual.getPageCount(); page += 1) {
    const actualPagePath = path.join(renderDirectory, `actual-${page}.png`);
    const expectedPagePath = path.join(renderDirectory, `expected-${page}.png`);
    assert.deepStrictEqual(
      actual.getPage(page - 1)?.getSize(),
      expected.getPage(page - 1)?.getSize(),
      `${label} page ${page}`,
    );
    await renderPdfPage(actualPath, actualPagePath, page, pdftocairoPath);
    await renderPdfPage(expectedPath, expectedPagePath, page, pdftocairoPath);
    await assertRasterMatches(actualPagePath, expectedPagePath, `${label} page ${page}`);
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
