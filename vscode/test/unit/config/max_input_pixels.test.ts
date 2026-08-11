import assert from 'node:assert/strict';

import { getExtensionConfiguration } from '../../../src/config/extension_configuration.js';
import { getDefaultConfiguration } from '../../../src/generated/extension_manifest.js';
import { fakeConfiguration } from '../../support/helpers/configuration.js';
import { withWorkspaceSettings } from '../../support/helpers/workspace_settings.js';

suite('Raster入力pixel上限設定', () => {
  test('raster.maxInputPixelsが未設定の場合は、マニフェスト既定のSharp既定値(maxInputPixels)を返す', async () => {
    await withWorkspaceSettings({ 'graphics-workbench.raster.maxInputPixels': undefined }, async () => {
      assert.strictEqual(
        getExtensionConfiguration().raster.maxInputPixels(),
        getDefaultConfiguration().raster.maxInputPixels(),
      );
    });
  });

  test('raster.maxInputPixelsに正の整数100を設定した場合は、その値100をそのまま返す', () => {
    assert.strictEqual(fakeConfiguration({ 'raster.maxInputPixels': 100 }).raster.maxInputPixels(), 100);
  });

  test('raster.maxInputPixelsに上限値1,000,000,000を設定した場合は、その上限値をそのまま返す', () => {
    assert.strictEqual(
      fakeConfiguration({ 'raster.maxInputPixels': 1_000_000_000 }).raster.maxInputPixels(),
      1_000_000_000,
    );
  });

  test('raster.maxInputPixelsの設定値がundefinedの場合は、マニフェスト既定のSharp既定値(268,402,689)へ戻して返す', () => {
    assert.strictEqual(
      fakeConfiguration({ 'raster.maxInputPixels': undefined }).raster.maxInputPixels(),
      getDefaultConfiguration().raster.maxInputPixels(),
    );
  });

  test('raster.maxInputPixelsに0・負数・小数・NaN・Infinity・文字列・MAX_SAFE_INTEGER超のいずれかを設定した場合は、マニフェスト既定のSharp既定値(268,402,689)へフォールバックする', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', Number.MAX_SAFE_INTEGER + 1]) {
      assert.strictEqual(
        fakeConfiguration({ 'raster.maxInputPixels': value }).raster.maxInputPixels(),
        getDefaultConfiguration().raster.maxInputPixels(),
        `unexpected value: ${String(value)}`,
      );
    }
  });
  test('VS Codeの実設定からraster.maxInputPixelsを型付き設定として読み取り、マニフェスト既定値と一致することを確認する', () => {
    const configuration = getExtensionConfiguration();
    assert.strictEqual(configuration.raster.maxInputPixels(), getDefaultConfiguration().raster.maxInputPixels());
  });
});
