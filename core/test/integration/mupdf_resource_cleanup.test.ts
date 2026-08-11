import assert from 'node:assert/strict';

import {
  hasPdfPageContent,
  renderPdfPageToPng,
  renderPdfPageToSvg,
} from '@graphics-workbench/core/operations/pdf/mupdf.js';
import { buildPdfFixture } from '../helpers/pdf_fixture_builder.js';

const pageCount = 12;
const renderIterations = 200;

suite('MuPDF WASMリソースの解放', () => {
  test('12ページのPDFを200回連続でページごとにhasPdfPageContent・PNG/SVG renderすると、render前後のプロセスRSS増加が150MiB未満に収まりWASMメモリがリークしない', async () => {
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
  return buildPdfFixture(
    Array.from({ length: pageCountValue }, () => ({
      width: 200,
      height: 200,
      contentOperations: 'q 0 0 0 rg 20 20 100 100 re f Q',
    })),
  );
}
