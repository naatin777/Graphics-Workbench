import assert from 'node:assert/strict';

import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  isSameSourceFormat,
  logicalSourcePathForOutputTemplate,
  sourceFormatForPath,
} from '../../src/application/policy/source_format.js';

suite('source format判定', () => {
  test('拡張子とeditable Draw.io compound extensionを一元判定する', () => {
    assert.strictEqual(sourceFormatForPath('diagram.DIO.SVG'), 'editable-drawio-svg');
    assert.strictEqual(sourceFormatForPath('image.JPEG'), 'jpeg');
    assert.strictEqual(sourceFormatForPath('image.GIF'), 'gif');
    assert.strictEqual(sourceFormatForPath('image.tiff'), 'tiff');
    assert.strictEqual(sourceFormatForPath('pixels.RAW'), 'raw');
    assert.strictEqual(sourceFormatForPath('chart.mermaid'), 'mermaid');
    assert.strictEqual(sourceFormatForPath('diagram.drawio'), 'drawio');
    assert.strictEqual(isNativeDrawioPath('diagram.DIO'), true);
    assert.strictEqual(sourceFormatForPath('notes.txt'), undefined);
    assert.strictEqual(isEditableDrawioImagePath('diagram.drawio.png'), true);
    assert.strictEqual(logicalSourcePathForOutputTemplate('diagram.drawio.png'), 'diagram');
  });

  test('出力形式のaliasを含めてsame-formatを判定する', () => {
    assert.strictEqual(isSameSourceFormat('image.png', '.png'), true);
    assert.strictEqual(isSameSourceFormat('image.jpg', '.jpeg'), true);
    assert.strictEqual(isSameSourceFormat('image.tiff', '.tif'), true);
    assert.strictEqual(isSameSourceFormat('diagram.drawio.png', '.png'), false);
    assert.strictEqual(isSameSourceFormat('image.png', '.webp'), false);
  });
});
