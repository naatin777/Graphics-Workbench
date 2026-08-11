import assert from 'node:assert/strict';
import path from 'node:path';

import sharp from 'sharp';

import { readTiffPreviewPageCount, renderTiffPreviewPage } from '../../../../src/operations/preview/tiff_preview.js';
import { testInputDirectory } from '../../../support/helpers/fixture_paths.js';

const heatmapTiffPath = path.join(testInputDirectory, 'valid', 'tiff', 'heatmap.tiff');
const truncatedTiffPath = path.join(testInputDirectory, 'invalid', 'tiff', 'truncated.tiff');

suite('TIFF previewのページ数読み取りとページ描画', () => {
  test('multi-page TIFF（heatmap.tiff）のページ数を返す', async () => {
    assert.strictEqual(await readTiffPreviewPageCount(heatmapTiffPath, 268402689), 4);
  });

  test('ページ指定で各ページをPNG data URIとして描画し、指定ページの寸法になる', async () => {
    const page = await renderTiffPreviewPage(heatmapTiffPath, 2, 268402689, 40000000);
    assert.ok(page.dataUri.startsWith('data:image/png;base64,'));
    const metadata = await sharp(Buffer.from(page.dataUri.split(',')[1] ?? '', 'base64')).metadata();
    assert.strictEqual(metadata.format, 'png');
    assert.strictEqual(metadata.width, 200);
    assert.strictEqual(metadata.height, 160);
  });

  test('maxCanvasPixelsを超えるページは縮小して描画する', async () => {
    const page = await renderTiffPreviewPage(heatmapTiffPath, 1, 268402689, 100000);
    const metadata = await sharp(Buffer.from(page.dataUri.split(',')[1] ?? '', 'base64')).metadata();
    assert.ok((metadata.width ?? 0) * (metadata.height ?? 0) <= 100000);
  });

  test('破損したTIFFはページ数読み取りで失敗する', async () => {
    await assert.rejects(readTiffPreviewPageCount(truncatedTiffPath, 268402689));
  });
});
