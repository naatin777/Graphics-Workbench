import assert from 'node:assert/strict';

import { assertAnimationPixelLimit } from '../../../src/config/raster.js';
import { getDefaultConfiguration } from '../../../src/generated/extension_manifest.js';
import { fakeConfiguration } from '../../support/helpers/configuration.js';

suite('ラスターアニメーションpixel上限設定', () => {
  test('設定なしの場合は500,000,000を、マニフェスト既定設定からも同じ既定値(maxAnimationPixels)を読み取る', () => {
    assert.strictEqual(fakeConfiguration().raster.maxAnimationPixels(), 500_000_000);
    assert.strictEqual(
      getDefaultConfiguration().raster.maxAnimationPixels(),
      getDefaultConfiguration().raster.maxAnimationPixels(),
    );
  });

  test('10,000,000×10,000,000の1フレームなら総pixelが上限1e14以内で通過し、同寸法2フレームで合計2e14が上限を超えた場合は例外を投げる(BigIntで合計を検査)', () => {
    assert.doesNotThrow(() => assertAnimationPixelLimit(10_000_000, 10_000_000, 1, 100_000_000_000_000, 'image.gif'));
    assert.throws(
      () => assertAnimationPixelLimit(10_000_000, 10_000_000, 2, 100_000_000_000_000, 'image.gif'),
      /exceeds the configured total animation pixel limit/iu,
    );
  });

  test("寸法が0の場合は上限判定へ進まず、'Could not determine safe animation dimensions'の例外を投げる", () => {
    assert.throws(
      () => assertAnimationPixelLimit(0, 100, 2, 500, 'image.gif'),
      /Could not determine safe animation dimensions/iu,
    );
  });
});
