import assert from 'node:assert/strict';

import { resolveOutputPathsTemplate } from '../../src/config/output/output_path_settings.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('outputPath設定', () => {
  test('outputPathの設定を読み取る', () => {
    const config = fakeConfiguration({
      'outputPath.convertPngToJpeg': 'flat/${file}.jpeg',
    });

    assert.strictEqual(config.outputPath.convertPngToJpeg(), 'flat/${file}.jpeg');
  });

  test('空のoutputPath設定をフォールバックせず読み取る', () => {
    const config = fakeConfiguration({
      'outputPath.convertPngToJpeg': '  ',
    });

    assert.strictEqual(config.outputPath.convertPngToJpeg(), '  ');
  });

  test('pageを含むoutputPathsの設定を読み取る', () => {
    const config = fakeConfiguration({ outputPaths: { convertPdfToPng: 'pdf/${page}.png' } });

    assert.strictEqual(resolveOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'), 'pdf/${page}.png');
  });

  test('outputPathsがスキーマに合わない場合は例外にする', () => {
    const invalidValues = [['invalid'], null, { convertPdfToPng: 1 }];

    for (const outputPaths of invalidValues) {
      const config = fakeConfiguration({ outputPaths });
      assert.throws(
        () => resolveOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'),
        /Invalid configuration value for graphics-workbench\.outputPaths: expected object, received/,
      );
    }
  });
});
