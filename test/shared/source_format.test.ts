import assert from 'node:assert/strict';

import {
  isEditableDrawioImagePath,
  isExcalidrawPath,
  isNativeDrawioPath,
  isSameSourceFormat,
  logicalSourcePathForOutputTemplate,
  sourceFormatForPath,
} from '../../src/shared/source_format.js';

suite('source format判定', () => {
  test('大文字小文字を無視して、拡張子（.jpg/.gif/.tiff/.eps/.mermaid等）と複合拡張子（.drawio.png/.drawio.svg/.drawio）とexcalidrawを単一のsourceFormatForPathで判定し、editable Draw.io画像は出力テンプレート用の論理パスから複合拡張子を除去する', () => {
    assert.strictEqual(sourceFormatForPath('diagram.DIO.SVG'), 'editable-drawio-svg');
    assert.strictEqual(sourceFormatForPath('image.JPEG'), 'jpeg');
    assert.strictEqual(sourceFormatForPath('image.GIF'), 'gif');
    assert.strictEqual(sourceFormatForPath('image.tiff'), 'tiff');
    assert.strictEqual(sourceFormatForPath('figure.EPS'), 'eps');
    assert.strictEqual(sourceFormatForPath('chart.mermaid'), 'mermaid');
    assert.strictEqual(sourceFormatForPath('diagram.drawio'), 'drawio');
    assert.strictEqual(isNativeDrawioPath('diagram.DIO'), true);
    assert.strictEqual(sourceFormatForPath('sketch.excalidraw'), 'excalidraw');
    assert.strictEqual(isExcalidrawPath('sketch.EXCALIDRAW'), true);
    assert.strictEqual(sourceFormatForPath('notes.txt'), undefined);
    assert.strictEqual(isEditableDrawioImagePath('diagram.drawio.png'), true);
    assert.strictEqual(logicalSourcePathForOutputTemplate('diagram.drawio.png'), 'diagram');
  });

  test('出力拡張子のalias（.jpgを.jpeg扱い・.tifを.tiff扱い）を正規化して同じ形式か判定し、editable Draw.io画像や異なる形式は不一致と判定する', () => {
    assert.strictEqual(isSameSourceFormat('image.png', '.png'), true);
    assert.strictEqual(isSameSourceFormat('image.jpg', '.jpeg'), true);
    assert.strictEqual(isSameSourceFormat('image.tiff', '.tif'), true);
    assert.strictEqual(isSameSourceFormat('diagram.drawio.png', '.png'), false);
    assert.strictEqual(isSameSourceFormat('image.png', '.webp'), false);
  });
});
