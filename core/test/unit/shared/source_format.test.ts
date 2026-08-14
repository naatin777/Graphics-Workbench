import assert from 'node:assert/strict';

import {
  isDrawioImagePath,
  isNativeDrawioPath,
  isSameSourceFormat,
  isSupportedPdfConversionSource,
  logicalSourcePathForOutputTemplate,
  sourceFormatForPath,
} from '@graphics-workbench/core/formats';

describe('source format判定', () => {
  it('大文字小文字を無視して、画像拡張子と複合拡張子（.drawio.png/.drawio.svg/.drawio）を判定し、editable Draw.io画像は出力テンプレート用の論理パスから複合拡張子を除去する', () => {
    assert.strictEqual(sourceFormatForPath('diagram.DIO.SVG'), 'drawio-svg');
    assert.strictEqual(sourceFormatForPath('image.JPEG'), 'jpeg');
    assert.strictEqual(sourceFormatForPath('image.GIF'), 'gif');
    assert.strictEqual(sourceFormatForPath('image.tiff'), 'tiff');
    assert.strictEqual(sourceFormatForPath('diagram.drawio'), 'drawio');
    assert.strictEqual(isNativeDrawioPath('diagram.DIO'), true);
    assert.strictEqual(sourceFormatForPath('notes.txt'), undefined);
    assert.strictEqual(isDrawioImagePath('diagram.drawio.png'), true);
    assert.strictEqual(logicalSourcePathForOutputTemplate('diagram.drawio.png'), 'diagram');
  });

  it('出力拡張子のalias（.jpgを.jpeg扱い・.tifを.tiff扱い）を正規化して同じ形式か判定し、editable Draw.io画像や異なる形式は不一致と判定する', () => {
    assert.strictEqual(isSameSourceFormat('image.png', '.png'), true);
    assert.strictEqual(isSameSourceFormat('image.jpg', '.jpeg'), true);
    assert.strictEqual(isSameSourceFormat('image.tiff', '.tif'), true);
    assert.strictEqual(isSameSourceFormat('diagram.drawio.png', '.png'), false);
    assert.strictEqual(isSameSourceFormat('image.png', '.webp'), false);
  });

  it('PDF変換の対応入力形式をsource format分類から判定し、未知形式とPDF自身を拒否する', () => {
    assert.strictEqual(isSupportedPdfConversionSource('image.png'), true);
    assert.strictEqual(isSupportedPdfConversionSource('diagram.drawio.svg'), true);
    assert.strictEqual(isSupportedPdfConversionSource('diagram.drawio'), false);
    assert.strictEqual(isSupportedPdfConversionSource('document.pdf'), false);
    assert.strictEqual(isSupportedPdfConversionSource('notes.txt'), false);
  });
});
