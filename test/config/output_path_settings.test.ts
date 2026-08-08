import assert from 'node:assert/strict';

import { resolveOutputPathsTemplate } from '../../src/config/output/output_path_settings.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('outputPath設定', () => {
  test("outputPath.convertPngToJpegに'flat/${file}.jpeg'を設定した場合、テンプレート文字列をそのまま読み取る", () => {
    const config = fakeConfiguration({
      'outputPath.convertPngToJpeg': 'flat/${file}.jpeg',
    });

    assert.strictEqual(config.outputPath.convertPngToJpeg(), 'flat/${file}.jpeg');
  });

  test("outputPath.convertPngToJpegに空白のみの'  'を設定した場合もフォールバックせず、そのまま'  'を返す", () => {
    const config = fakeConfiguration({
      'outputPath.convertPngToJpeg': '  ',
    });

    assert.strictEqual(config.outputPath.convertPngToJpeg(), '  ');
  });

  test("outputPaths.convertPdfToPngに'pdf/${page}.png'を設定した場合、page変数を含むテンプレートをそのまま解決結果として返す", () => {
    const config = fakeConfiguration({ outputPaths: { convertPdfToPng: 'pdf/${page}.png' } });

    assert.strictEqual(resolveOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'), 'pdf/${page}.png');
  });

  test("outputPathsに配列・null・数値を値に持つオブジェクトのいずれかを設定した場合、既定のテンプレート'default.png'へフォールバックする", () => {
    const invalidValues = [['invalid'], null, { convertPdfToPng: 1 }];

    for (const outputPaths of invalidValues) {
      const config = fakeConfiguration({ outputPaths });
      assert.strictEqual(resolveOutputPathsTemplate(config, 'convertPdfToPng', 'default.png'), 'default.png');
    }
  });
});
