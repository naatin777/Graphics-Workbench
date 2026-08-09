// Test target:
// - Auto Crop のcontent検出に `DisplayList.getBounds()` を置き換えられないことを、
//   APIのactual semanticsで示すこと
// - pdfcrop互換の unified content detector（白背景render・純白のみbackground）のsemantics
//
// Background:
// MuPDFの `fz_bound_display_list` はdisplay listのmediabox（ページbox）を返す。
// page.toDisplayList(...).getBounds() は描画contentのboundsではなくページ全体を返すため、
// Auto Cropのcontent検出には使えない。このtestはそのsemanticsと、
// pdfcrop互換の「白背景へrenderして非純白pixelのboundsを取る」統一detectorを固定する。
//
// Mocked:
// - なし。実mupdfを使用する（pixmap unit testのみfake pixmap）。
//
// Not tested:
// - cropPdfFilesコマンド全体（crop_pdf_auto.test.tsが対象）

import assert from 'node:assert/strict';

import { PDFDocument, rgb } from '../helpers/pdf_document.js';

import {
  findVisiblePixelBounds,
  hasPdfPageContent,
  loadMupdf,
  renderPdfPageToPng,
  savePdfDocument,
  type MupdfPixmap,
} from '../../src/operations/pdf/mupdf.js';

suite('DisplayList.getBoundsはcontent boundsではない（raster検出の必要性）', () => {
  test('中央にcontentがあるページでも toDisplayList().getBounds() はページ全体（mediabox）を返し、contentに縮まない', async () => {
    const bytes = await buildCenteredContentPdf();
    const { default: mupdf } = await import('mupdf');
    const document = mupdf.Document.openDocument(bytes);
    const pdf = document.asPDF();
    assert.ok(pdf);
    const page = pdf.loadPage(0);
    try {
      const mediabox = page.getBounds('MediaBox');
      assert.deepStrictEqual(mediabox, [0, 0, 300, 200]);

      const displayList = page.toDisplayList(false);
      try {
        assert.deepStrictEqual(displayList.getBounds(), mediabox);
      } finally {
        displayList.destroy();
      }

      const displayListWithExtras = page.toDisplayList(true);
      try {
        assert.deepStrictEqual(displayListWithExtras.getBounds(), mediabox);
      } finally {
        displayListWithExtras.destroy();
      }
    } finally {
      page.destroy();
      pdf.destroy();
    }
  });

  test('空ページの toDisplayList().getBounds() もページ全体を返し、『contentなし』と区別できない', async () => {
    const bytes = await buildBlankPdf();
    const { default: mupdf } = await import('mupdf');
    const document = mupdf.Document.openDocument(bytes);
    const pdf = document.asPDF();
    assert.ok(pdf);
    const page = pdf.loadPage(0);
    try {
      const displayList = page.toDisplayList(false);
      try {
        assert.deepStrictEqual(displayList.getBounds(), [0, 0, 300, 200]);
      } finally {
        displayList.destroy();
      }
    } finally {
      page.destroy();
      pdf.destroy();
    }
  });

  test('raster検出は中央のcontentだけへ縮み、空ページはcontentなしと判定する（現行semanticsを維持）', async () => {
    const contentBytes = await buildCenteredContentPdf();
    const blankBytes = await buildBlankPdf();

    assert.strictEqual(await hasPdfPageContent(contentBytes, 1), true);
    assert.strictEqual(await hasPdfPageContent(blankBytes, 1), false);

    const croppedPng = await renderPdfPageToPng(contentBytes, 1, { cropContent: true });
    const fullPng = await renderPdfPageToPng(contentBytes, 1);
    assert.ok(pngWidth(croppedPng) < pngWidth(fullPng), 'cropContent で余白がtrimされていない');
    assert.ok(pngHeight(croppedPng) < pngHeight(fullPng), 'cropContent で余白がtrimされていない');
  });
});

suite('pdfcrop互換のvisible content検出（白背景render・純白だけがbackground）', () => {
  test('全面の白rectangleだけのページはcontentなしと判定する（pdfcropと同じく白は墨ではない）', async () => {
    const bytes = await buildPdfWithContent('q 1 1 1 rg 0 0 300 200 re f Q');

    assert.strictEqual(await hasPdfPageContent(bytes, 1), false);
  });

  test('全面の白rectangle＋中央contentはcontentとして検出し、cropContentで白rectangleを含む余白をtrimする', async () => {
    const bytes = await buildPdfWithContent('q 1 1 1 rg 0 0 300 200 re f Q q 0 0 0 rg 100 50 100 100 re f Q');

    assert.strictEqual(await hasPdfPageContent(bytes, 1), true);
    const croppedPng = await renderPdfPageToPng(bytes, 1, { cropContent: true });
    const fullPng = await renderPdfPageToPng(bytes, 1);
    assert.ok(pngWidth(croppedPng) < pngWidth(fullPng), '白rectangle背景が余白としてtrimされていない');
    assert.ok(pngHeight(croppedPng) < pngHeight(fullPng), '白rectangle背景が余白としてtrimされていない');
  });

  test('薄いグレー（#FCFCFC）もcontentとして検出する（純白 #FFFFFF だけがbackground）', async () => {
    const bytes = await buildPdfWithContent('q 0.988235294 0.988235294 0.988235294 rg 100 50 100 100 re f Q');

    assert.strictEqual(await hasPdfPageContent(bytes, 1), true);
    const croppedPng = await renderPdfPageToPng(bytes, 1, { cropContent: true });
    const fullPng = await renderPdfPageToPng(bytes, 1);
    assert.ok(pngWidth(croppedPng) < pngWidth(fullPng), '#FCFCFCがcontentとして検出されていない');
  });

  test('buffer長がRGB layoutと矛盾するpixmapは、白ページと誤認せずinvariant違反としてthrowする', () => {
    assert.throws(
      () => findVisiblePixelBounds(makePixmap(2, 2, new Uint8ClampedArray(2 * 2 * 2))),
      /does not match the DeviceRGB layout/,
    );
    assert.throws(
      () => findVisiblePixelBounds(makePixmap(2, 2, new Uint8ClampedArray(2 * 2 * 4))),
      /does not match the DeviceRGB layout/,
    );
  });

  test('純白だけのbufferはcontentなし、1バイトでも非白を含むbufferはboundsを返す', () => {
    const white = new Uint8ClampedArray(3 * 3 * 3);
    white.fill(255);
    assert.strictEqual(findVisiblePixelBounds(makePixmap(3, 3, white)), undefined);

    const nearWhite = new Uint8ClampedArray(3 * 3 * 3);
    nearWhite.fill(255);
    nearWhite[12] = 254;
    assert.deepStrictEqual(findVisiblePixelBounds(makePixmap(3, 3, nearWhite)), [1, 1, 2, 2]);
  });
});

async function buildCenteredContentPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  page.drawRectangle({ x: 100, y: 50, width: 100, height: 100, color: rgb(0, 0, 0) });
  return document.save();
}

async function buildBlankPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([300, 200]);
  return document.save();
}

async function buildPdfWithContent(contentOps: string): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const document = new mupdf.PDFDocument();
  const page = document.newDictionary();
  page.put('Type', document.newName('Page'));
  page.put('MediaBox', [0, 0, 300, 200]);
  page.put('Contents', document.addStream(contentOps, null));
  document.insertPage(0, document.addObject(page));
  return savePdfDocument(document);
}

function makePixmap(width: number, height: number, pixels: Uint8ClampedArray): MupdfPixmap {
  return {
    getWidth: () => width,
    getHeight: () => height,
    getPixels: () => pixels,
    asPNG: () => new Uint8Array(),
    destroy: () => {},
  };
}

function pngWidth(png: Uint8Array): number {
  return readPngDimension(png, 16);
}

function pngHeight(png: Uint8Array): number {
  return readPngDimension(png, 20);
}

function readPngDimension(png: Uint8Array, offset: number): number {
  const dataView = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return dataView.getUint32(offset);
}
