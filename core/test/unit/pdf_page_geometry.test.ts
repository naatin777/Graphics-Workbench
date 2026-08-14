import assert from 'node:assert/strict';

import { getPdfPageGeometry, openPdfDocument } from '@graphics-workbench/core/pdf';
import { createPdfTestData } from '@graphics-workbench/core/testing';

describe('PDFページのジオメトリ取得', () => {
  it('負のオフセットや90/270度回転を持つPDFページから、絶対座標のMediaBox/CropBoxと正規化されない回転角をそのまま返す', async () => {
    const bytes = await createPdfTestData({
      pages: [
        { mediaBox: [100, 200, 700, 1000], cropBox: [120, 220, 620, 920], rotation: 90 },
        { mediaBox: [-10, -20, 390, 280], cropBox: [-5, -10, 195, 140], rotation: 270 },
      ],
    });

    const reloaded = await openPdfDocument(bytes);
    try {
      assert.deepStrictEqual(getPdfPageGeometry(reloaded.loadPage(0), 1), {
        page: 1,
        mediaBox: { x: 100, y: 200, width: 600, height: 800 },
        cropBox: { x: 120, y: 220, width: 500, height: 700 },
        rotation: 90,
      });
      assert.deepStrictEqual(getPdfPageGeometry(reloaded.loadPage(1), 2), {
        page: 2,
        mediaBox: { x: -10, y: -20, width: 400, height: 300 },
        cropBox: { x: -5, y: -10, width: 200, height: 150 },
        rotation: 270,
      });
    } finally {
      reloaded.destroy();
    }
  });
});
