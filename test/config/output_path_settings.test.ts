import assert from 'node:assert/strict';

import { configs } from '../../src/generated-extension-meta.js';
import { resolveOutputPathsTemplate } from '../../src/config/output/output_path_settings.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('outputPath設定', () => {
  test('outputPathの設定を読み取る', () => {
    const config = fakeConfiguration({
      'outputPath.convertPngToJpeg': 'flat/${file}.jpeg',
    });

    assert.strictEqual(configs.outputPath.convertPngToJpeg(config), 'flat/${file}.jpeg');
  });

  test('空のoutputPath設定をフォールバックせず読み取る', () => {
    const config = fakeConfiguration({
      'outputPath.convertPngToJpeg': '  ',
    });

    assert.strictEqual(configs.outputPath.convertPngToJpeg(config), '  ');
  });

  test('pageを含むoutputPathsの設定を読み取る', () => {
    const config = fakeConfiguration({ outputPaths: { convertPdfToPng: 'pdf/${page}.png' } });

    assert.strictEqual(resolveOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'), 'pdf/${page}.png');
  });

  test('outputPathsが配列・null・非文字列の場合は既定値を使う', () => {
    const invalidValues = [['invalid'], null, { convertPdfToPng: 1 }];

    for (const outputPaths of invalidValues) {
      const config = fakeConfiguration({ outputPaths });
      assert.strictEqual(resolveOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'), 'default.png');
    }
  });
});
