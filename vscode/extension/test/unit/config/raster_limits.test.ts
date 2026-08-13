import assert from 'node:assert/strict';

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
});
