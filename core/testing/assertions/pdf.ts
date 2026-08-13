import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { renderPdfPageToPng } from '@graphics-workbench/core/pdf';

import { PDFDocument } from '../document.js';
import { assertRasterMatches } from './raster.js';
import type { RasterComparisonOptions } from './raster_content.js';

export interface PdfPageVisualComparison {
  expectedPdfPath: string;
  expectedPageNumber: number;
  actualPdfPath: string;
  actualPageNumber: number;
  renderDirectory: string;
  renderPrefix: string;
  dpi?: number;
}

export async function assertRenderedPdfPagesSimilar(comparison: PdfPageVisualComparison): Promise<void> {
  const dpi = comparison.dpi ?? 144;
  await mkdir(comparison.renderDirectory, { recursive: true });

  const expectedPngPath = await renderPdfPage(
    comparison.expectedPdfPath,
    path.join(comparison.renderDirectory, `${comparison.renderPrefix}-expected`),
    comparison.expectedPageNumber,
    dpi,
  );
  const actualPngPath = await renderPdfPage(
    comparison.actualPdfPath,
    path.join(comparison.renderDirectory, `${comparison.renderPrefix}-actual`),
    comparison.actualPageNumber,
    dpi,
  );

  await assertPngsSimilar(await readFile(expectedPngPath), await readFile(actualPngPath));
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
    await renderPdfPage(actualPath, actualPagePath, page, 144);
    await renderPdfPage(expectedPath, expectedPagePath, page, 144);
    await assertRasterMatches(actualPagePath, expectedPagePath, `${label} page ${page}`, options);
  }
}

async function renderPdfPage(sourcePath: string, outputPath: string, page: number, dpi: number): Promise<string> {
  const pdfBytes = await readFile(sourcePath);
  const png = await renderPdfPageToPng(pdfBytes, page, { dpi });
  await writeFile(outputPath, png);
  return outputPath;
}

async function assertPngsSimilar(expectedPng: Buffer, actualPng: Buffer): Promise<void> {
  const [expected, actual] = await Promise.all([
    sharp(expectedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(actualPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  assert.strictEqual(actual.info.width, expected.info.width);
  assert.strictEqual(actual.info.height, expected.info.height);
  assert.strictEqual(actual.info.channels, expected.info.channels);

  const exactDifference = calculatePixelDifference(expected, actual, 0, 0);
  const shiftedDifferences = [
    calculatePixelDifference(expected, actual, -1, -1),
    calculatePixelDifference(expected, actual, 0, -1),
    calculatePixelDifference(expected, actual, 1, -1),
    calculatePixelDifference(expected, actual, -1, 0),
    calculatePixelDifference(expected, actual, 1, 0),
    calculatePixelDifference(expected, actual, -1, 1),
    calculatePixelDifference(expected, actual, 0, 1),
    calculatePixelDifference(expected, actual, 1, 1),
  ];
  const closestShiftDifference = Math.min(
    ...shiftedDifferences.map(({ meanChannelDifference }) => meanChannelDifference),
  );

  assert.ok(
    exactDifference.differentPixelRatio <= 0.003,
    `Rendered PDF pixel mismatch ratio was ${exactDifference.differentPixelRatio}.`,
  );
  assert.ok(
    exactDifference.meanChannelDifference <= 0.1,
    `Rendered PDF mean channel difference was ${exactDifference.meanChannelDifference}.`,
  );
  assert.ok(
    exactDifference.meanChannelDifference * 5 < closestShiftDifference,
    `Rendered PDF content is closer to a one-pixel shift (${closestShiftDifference}) than the expected position (${exactDifference.meanChannelDifference}).`,
  );
}

function calculatePixelDifference(
  expected: RawImage,
  actual: RawImage,
  offsetX: number,
  offsetY: number,
): { differentPixelRatio: number; meanChannelDifference: number } {
  let comparedPixels = 0;
  let differentPixels = 0;
  let totalDifference = 0;
  const { channels } = expected.info;

  for (let expectedY = 0; expectedY < expected.info.height; expectedY += 1) {
    for (let expectedX = 0; expectedX < expected.info.width; expectedX += 1) {
      const actualX = expectedX + offsetX;
      const actualY = expectedY + offsetY;

      if (actualX < 0 || actualY < 0 || actualX >= actual.info.width || actualY >= actual.info.height) {
        continue;
      }

      let maximumChannelDifference = 0;

      for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
        const expectedIndex = (expectedY * expected.info.width + expectedX) * channels + channelIndex;
        const actualIndex = (actualY * actual.info.width + actualX) * channels + channelIndex;
        const difference = Math.abs((expected.data[expectedIndex] ?? 0) - (actual.data[actualIndex] ?? 0));
        maximumChannelDifference = Math.max(maximumChannelDifference, difference);
        totalDifference += difference;
      }

      if (maximumChannelDifference > 8) {
        differentPixels += 1;
      }
      comparedPixels += 1;
    }
  }

  return {
    differentPixelRatio: differentPixels / comparedPixels,
    meanChannelDifference: totalDifference / (comparedPixels * channels),
  };
}

interface RawImage {
  data: Uint8Array;
  info: {
    width: number;
    height: number;
    channels: number;
  };
}
