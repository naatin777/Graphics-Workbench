import { describe, expect, test } from 'vitest';

import { calculatePdfCanvasDimensions } from '@webview-shared/pdf/canvas_limits';

describe('PDF preview canvas limits', () => {
  test('caps output pixels after applying the device pixel ratio', () => {
    const dimensions = calculatePdfCanvasDimensions(2000, 1000, 4, {
      maxCanvasPixels: 1_000_000,
      maxDevicePixelRatio: 2,
    });

    expect(dimensions.outputScale).toBeLessThanOrEqual(2);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(1_000_000);
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
  });

  test('uses finite positive dimensions for invalid PDF geometry and DPR', () => {
    const dimensions = calculatePdfCanvasDimensions(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, {
      maxCanvasPixels: Number.POSITIVE_INFINITY,
      maxDevicePixelRatio: Number.POSITIVE_INFINITY,
    });

    expect(dimensions.width).toBe(1);
    expect(dimensions.height).toBe(1);
    expect(Number.isFinite(dimensions.outputScale)).toBe(true);
  });
});
