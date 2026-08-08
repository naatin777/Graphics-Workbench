import assert from 'node:assert/strict';

import { PDFDocument } from 'pdf-lib';

import { hasPdfPageContent, renderPdfPageToPng, renderPdfPageToSvg } from '../../src/operations/pdf/mupdf.js';

const pageCount = 12;
const renderIterations = 200;

suite('MuPDF resource cleanup', () => {
  test('PDFページを連続renderしてもWASM memoryが増え続けない', async () => {
    const bytes = await createMultiPagePdf(pageCount);

    // Warm up the module, JIT, and first allocations before measuring.
    for (let index = 0; index < 24; index += 1) {
      await renderOnePage(bytes, (index % pageCount) + 1);
    }

    const before = process.memoryUsage().rss;
    for (let index = 0; index < renderIterations; index += 1) {
      await renderOnePage(bytes, (index % pageCount) + 1);
    }
    const after = process.memoryUsage().rss;

    const growthMb = (after - before) / 1024 / 1024;
    assert.ok(
      growthMb < 150,
      `MuPDF WASM memory grew ${growthMb.toFixed(1)} MiB over ${renderIterations} renders; page/device objects may be leaking`,
    );
  });
});

async function renderOnePage(bytes: Uint8Array, page: number): Promise<void> {
  await hasPdfPageContent(bytes, page);
  await renderPdfPageToPng(bytes, page);
  await renderPdfPageToSvg(bytes, page);
}

async function createMultiPagePdf(pageCountValue: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCountValue; index += 1) {
    const page = document.addPage([200, 200]);
    page.drawRectangle({ x: 20, y: 20, width: 100, height: 100 });
  }
  return document.save();
}
