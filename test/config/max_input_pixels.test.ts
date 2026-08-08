import assert from 'node:assert/strict';

import { getExtensionConfiguration } from '../../src/config/extension_configuration.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { getMaxInputPixels } from '../../src/config/raster.js';
import { fakeConfiguration } from '../helpers/configuration.js';
import { withWorkspaceSettings } from '../helpers/workspace_settings.js';

suite('Raster入力pixel上限設定', () => {
  test('raster.maxInputPixelsが未設定の場合は、マニフェスト既定のSharp既定値(maxInputPixels)を返す', async () => {
    await withWorkspaceSettings({ 'graphics-workbench.raster.maxInputPixels': undefined }, async () => {
      assert.strictEqual(
        getMaxInputPixels(getExtensionConfiguration()),
        getDefaultConfiguration().raster.maxInputPixels(),
      );
    });
  });

  test('raster.maxInputPixelsに正の整数100を設定した場合は、その値100をそのまま返す', () => {
    assert.strictEqual(getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': 100 })), 100);
  });

  test('raster.maxInputPixelsに上限値1,000,000,000を設定した場合は、その上限値をそのまま返す', () => {
    assert.strictEqual(getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': 1_000_000_000 })), 1_000_000_000);
  });

  test('raster.maxInputPixelsの設定値がundefinedの場合は、マニフェスト既定のSharp既定値(268,402,689)へ戻して返す', () => {
    assert.strictEqual(
      getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': undefined })),
      getDefaultConfiguration().raster.maxInputPixels(),
    );
  });

  test('raster.maxInputPixelsに0・負数・小数・NaN・Infinity・文字列・MAX_SAFE_INTEGER超のいずれかを設定した場合は、マニフェスト既定のSharp既定値(268,402,689)へフォールバックする', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', Number.MAX_SAFE_INTEGER + 1]) {
      assert.strictEqual(
        getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': value })),
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
