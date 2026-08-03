import assert from 'node:assert/strict';

import { getExtensionConfiguration } from '../../src/generated-extension-config.js';
import { getDefaultConfiguration } from '../../src/generated-extension-meta.js';
import { getMaxInputPixels } from '../../src/config/raster_input.js';
import { fakeConfiguration } from '../helpers/configuration.js';
import { withWorkspaceSettings } from '../helpers/workspace_settings.js';

suite('Raster入力pixel上限設定', () => {
  test('未設定時はSharp既定値を返す', async () => {
    await withWorkspaceSettings({ 'graphics-workbench.raster.maxInputPixels': undefined }, async () => {
      assert.strictEqual(
        getMaxInputPixels(getExtensionConfiguration()),
        getDefaultConfiguration().raster.maxInputPixels(),
      );
    });
  });

  test('正の整数のカスタム値を返す', async () => {
    await withWorkspaceSettings({ 'graphics-workbench.raster.maxInputPixels': 100 }, async () => {
      assert.strictEqual(getMaxInputPixels(getExtensionConfiguration()), 100);
    });
  });

  test('最大値は1,000,000,000に制限される', () => {
    assert.strictEqual(getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': 1_000_000_000 })), 1_000_000_000);
    assert.throws(
      () => getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': 1_000_000_001 })),
      /Invalid configuration value for graphics-workbench\.raster\.maxInputPixels/iu,
    );
  });

  test('未設定の値は既定値へ戻す', () => {
    assert.strictEqual(
      getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': undefined })),
      getDefaultConfiguration().raster.maxInputPixels(),
    );
  });

  test('スキーマに合わない値は例外にする', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': value })),
        /Invalid configuration value for graphics-workbench\.raster\.maxInputPixels: expected integer, received/,
        `unexpected value: ${String(value)}`,
      );
    }
  });
  test('VS Code設定を型付き設定として読み取れる', () => {
    const configuration = getExtensionConfiguration();
    assert.strictEqual(configuration.raster.maxInputPixels(), getDefaultConfiguration().raster.maxInputPixels());
  });
});
