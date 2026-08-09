import assert from 'node:assert/strict';

import { resolveOutputPathTemplate } from '../../src/config/output/output_path_settings.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('outputPath設定', () => {
  test("outputPath.convertPngToJpegに'flat/${file}.jpeg'を設定した場合、テンプレート文字列をそのまま読み取る", () => {
    const config = fakeConfiguration({
      'outputPath.convertPngToJpeg': 'flat/${file}.jpeg',
    });

    assert.strictEqual(config.outputPath.convertPngToJpeg(), 'flat/${file}.jpeg');
  });

  test("outputPath.convertPdfToPngに'pdf/${page}.png'を設定した場合、page変数を含むテンプレートをそのまま読み取る", () => {
    const config = fakeConfiguration({
      'outputPath.convertPdfToPng': 'pdf/${page}.png',
    });

    assert.strictEqual(config.outputPath.convertPdfToPng(), 'pdf/${page}.png');
  });

  test("空の個別設定は正本の既定テンプレート'default.png'へフォールバックする", () => {
    assert.strictEqual(resolveOutputPathTemplate('  ', 'default.png'), 'default.png');
  });
});
