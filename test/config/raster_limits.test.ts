import assert from 'node:assert/strict';

import { assertAnimationPixelLimit, getMaxAnimationPixels } from '../../src/config/raster_limits.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('ラスターアニメーションpixel上限設定', () => {
  test('既定値と設定値を読み取る', () => {
    assert.strictEqual(getMaxAnimationPixels(fakeConfiguration()), 500_000_000);
    assert.strictEqual(
      getMaxAnimationPixels(getDefaultConfiguration()),
      getDefaultConfiguration().raster.maxAnimationPixels(),
    );
  });

  test('BigIntで全フレームの合計を検査する', () => {
    assert.doesNotThrow(() => assertAnimationPixelLimit(10_000_000, 10_000_000, 1, 100_000_000_000_000, 'image.gif'));
    assert.throws(
      () => assertAnimationPixelLimit(10_000_000, 10_000_000, 2, 100_000_000_000_000, 'image.gif'),
      /exceeds the configured total animation pixel limit/iu,
    );
  });

  test('不正な寸法は上限判定を通過させない', () => {
    assert.throws(
      () => assertAnimationPixelLimit(0, 100, 2, 500, 'image.gif'),
      /Could not determine safe animation dimensions/iu,
    );
  });
});
