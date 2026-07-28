import assert from 'node:assert/strict';

import { readOutputPathTemplate, readOutputPathsTemplate } from '../../src/config/output/output_path_settings.js';

function configuration(values: Record<string, unknown>) {
  return {
    get(key: string, defaultValue: unknown): unknown {
      return values[key] ?? defaultValue;
    },
  };
}

suite('outputPath設定', () => {
  test('outputPathの設定を読み取る', () => {
    const config = configuration({
      'outputPath.convertPngToJpeg': 'flat/${file}.jpeg',
    });

    assert.strictEqual(
      readOutputPathTemplate(config, 'outputPath.convertPngToJpeg', 'default.jpeg'),
      'flat/${file}.jpeg',
    );
  });

  test('空のoutputPath設定は既定値へfallbackする', () => {
    const config = configuration({
      'outputPath.convertPngToJpeg': '  ',
    });

    assert.strictEqual(readOutputPathTemplate(config, 'outputPath.convertPngToJpeg', 'default.jpeg'), 'default.jpeg');
  });

  test('pageを含むoutputPathsの設定を読み取る', () => {
    const config = configuration({ outputPaths: { convertPdfToPng: 'pdf/${page}.png' } });

    assert.strictEqual(readOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'), 'pdf/${page}.png');
  });

  test('outputPathsが配列や非文字列の場合は既定値を使う', () => {
    const config = configuration({
      outputPaths: ['invalid'],
    });

    assert.strictEqual(readOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'), 'default.png');
  });
});
