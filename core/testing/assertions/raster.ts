import assert from 'node:assert/strict';

import {
  calculateRgbaDifference,
  readNormalizedRgbaPixels,
  readRgbaPixels,
  type RasterComparisonOptions,
} from './raster_content.js';

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
