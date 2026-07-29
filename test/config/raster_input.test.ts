import assert from 'node:assert/strict';

import { getExtensionConfiguration } from '../../src/generated-extension-config.js';
import { configs } from '../../src/generated-extension-meta.js';
import { getMaxInputPixels } from '../../src/config/raster_input.js';
import { fakeConfiguration } from '../helpers/configuration.js';
import { withWorkspaceSettings } from '../helpers/workspace_settings.js';

suite('Raster入力pixel上限設定', () => {
  test('未設定時はSharp既定値を返す', async () => {
    await withWorkspaceSettings({ 'graphics-workbench.raster.maxInputPixels': undefined }, async () => {
      assert.strictEqual(getMaxInputPixels(getExtensionConfiguration()), configs.raster.maxInputPixels());
    });
  });

  test('正の整数のカスタム値を返す', async () => {
    await withWorkspaceSettings({ 'graphics-workbench.raster.maxInputPixels': 100 }, async () => {
      assert.strictEqual(getMaxInputPixels(getExtensionConfiguration()), 100);
    });
  });

  test('不正な値は既定値へ戻す', () => {
    for (const value of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '100',
      Number.MAX_SAFE_INTEGER + 1,
      undefined,
    ]) {
      assert.strictEqual(
        getMaxInputPixels(fakeConfiguration({ 'raster.maxInputPixels': value })),
        configs.raster.maxInputPixels(),
        `unexpected value: ${String(value)}`,
      );
    }
  });
  test('設定項目がworkspace設定として公開される', () => {
    const configuration = getExtensionConfiguration();
    assert.strictEqual(configuration.get<number>('raster.maxInputPixels'), configs.raster.maxInputPixels());
  });
});
