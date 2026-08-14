import assert from 'node:assert/strict';

import { hasPdfPageContent, renderPdfPageToPng, renderPdfPageToSvg } from '@graphics-workbench/core/pdf';
import { createPdfTestData, fillRectangle } from '@graphics-workbench/core/testing';

const pageCount = 12;
const renderIterations = 200;

describe('MuPDF WASMリソースの解放', () => {
  it('12ページのPDFを200回連続でページごとにhasPdfPageContent・PNG/SVG renderすると、render前後のプロセスRSS増加が150MiB未満に収まりWASMメモリがリークしない', async () => {
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
  return createPdfTestData({
    pages: Array.from({ length: pageCountValue }, () => ({
      mediaBox: [0, 0, 200, 200],
      contents: [fillRectangle({ x: 20, y: 20, width: 100, height: 100 })],
    })),
  });
}
