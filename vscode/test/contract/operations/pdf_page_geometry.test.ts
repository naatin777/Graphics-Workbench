import assert from 'node:assert/strict';

import { degrees, PDFDocument } from '../../support/helpers/pdf_document.js';

import { getPdfPageGeometry, openPdfDocument } from '@graphics-workbench/core/pdf';

suite('PDFページのジオメトリ取得', () => {
  test('負のオフセットや90/270度回転を持つPDFページから、絶対座標のMediaBox/CropBoxと正規化されない回転角をそのまま返す', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([600, 800]);
    page.setMediaBox(100, 200, 600, 800);
    page.setCropBox(120, 220, 500, 700);
    page.setRotation(degrees(90));

    const secondPage = document.addPage([400, 300]);
    secondPage.setMediaBox(-10, -20, 400, 300);
    secondPage.setCropBox(-5, -10, 200, 150);
    secondPage.setRotation(degrees(270));

    const reloaded = await openPdfDocument(await document.save());
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
