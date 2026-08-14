// Test target:
// - 複数の入力画像・PDFを1つのDraw.io XML（.drawio）へ集約する
// - PDFの各ページをPDF→SVG変換へ通して1ページずつSVGデータURIへ展開する
// - アニメーションGIF/WebP・マルチページTIFFの先頭フレームをPNGデータURIへ正規化する
// - editable画像（.drawio.png/.drawio.svg）のDraw.io CLI export失敗時に出力を作らない
//
// Not tested:
// - Draw.io CLI実体によるeditable画像exportの成功（external oracles側で確認）

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import {
  convertSingleDrawio,
  createDrawioXml,
  parseSvgSize,
  type ConversionSource,
} from '@graphics-workbench/core/conversion';
import { createPdfTestData, testConversionConfiguration } from '@graphics-workbench/core/testing';

function sourceAt(workspacePath: string, sourcePath: string): ConversionSource {
  return {
    sourcePath,
    workspacePath,
    workspaceName: path.basename(workspacePath),
  };
}

describe('複数の入力画像・PDFを1つのDraw.io XMLへ集約する', () => {
  it('XML生成で各画像を1つのshape=imageオブジェクトにし、同名ページをnameとname-2へ連番化する', () => {
    const xml = createDrawioXml([
      { name: 'same', dataUri: 'data:image/png;base64,AA==', width: 10, height: 20 },
      { name: 'same', dataUri: 'data:image/svg+xml;base64,BB==', width: 30, height: 40 },
    ]);
    assert.match(xml, /name="same"/);
    assert.match(xml, /name="same-2"/);
    assert.strictEqual((xml.match(/shape=image/g) ?? []).length, 2);
  });

  it('SVGサイズをwidth/height（ptはpxへ変換）で判定し、片方だけならviewBoxの比率から補完し、両方無ければdimensionsエラーを返す', () => {
    assert.deepStrictEqual(parseSvgSize('<svg width="12pt" height="8pt"/>'), { width: 12, height: 8 });
    assert.deepStrictEqual(parseSvgSize('<svg viewBox="0 0 640 480"/>'), { width: 640, height: 480 });
    assert.deepStrictEqual(parseSvgSize('<svg width="320" viewBox="0 0 640 480"/>'), { width: 320, height: 240 });
    assert.deepStrictEqual(parseSvgSize('<svg height="240" viewBox="0 0 640 480"/>'), { width: 320, height: 240 });
    assert.throws(() => parseSvgSize('<svg/>'), /dimensions/);
  });

  it('PNGと2ページPDFを1つのdrawioへ集約し、PDFの各ページ（1・2）をPDF→SVG変換処理へ順に通して1ページずつSVGデータURIとして画像化したXMLを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-to-drawio-'));
    const imagePath = path.join(workspacePath.path, 'image.png');
    const pdfPath = path.join(workspacePath.path, 'input.pdf');
    await sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
      .png()
      .toFile(imagePath);
    const pdfBytes = await createPdfTestData({
      pages: [{ mediaBox: [0, 0, 100, 50] }, { mediaBox: [0, 0, 80, 40] }],
    });
    await writeFile(pdfPath, pdfBytes);

    const result = await convertSingleDrawio(
      [sourceAt(workspacePath.path, imagePath), sourceAt(workspacePath.path, pdfPath)],
      '${fileDirname}/combined.drawio',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: 'drawio' }),
      { resolveConflicts: async () => 'overwrite' },
    );
    if (result.isErr()) {
      throw result.error;
    }

    const xml = await readFile(path.join(workspacePath.path, 'combined.drawio'), 'utf8');
    assert.strictEqual((xml.match(/shape=image/g) ?? []).length, 3);
    assert.match(xml, /data:image\/svg\+xml;base64/);
    assert.match(xml, /data:image\/png;base64/);
  });

  it('アニメーションGIF/WebP・マルチページTIFFの先頭フレームをPNGデータURIへ正規化し、ページ寸法20x10をXML（pageWidth/pageHeight/mxGeometry）へ設定する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-to-drawio-raster-frames-'));
    const red = await sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
      .png()
      .toBuffer();
    const blue = await sharp({ create: { width: 20, height: 10, channels: 4, background: 'blue' } })
      .png()
      .toBuffer();
    const inputs = [
      ['animated.gif', 'gif'],
      ['animated.webp', 'webp'],
      ['multipage.tiff', 'tiff'],
    ] as const;
    const sources: ConversionSource[] = [];
    for (const [name, format] of inputs) {
      const animatedImage = sharp([red, blue], { join: { animated: true } });
      const sourcePath = path.join(workspacePath.path, name);
      await animatedImage[format]().toFile(sourcePath);
      sources.push(sourceAt(workspacePath.path, sourcePath));
    }

    const result = await convertSingleDrawio(
      sources,
      '${fileDirname}/result.drawio',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: 'drawio' }),
      { resolveConflicts: async () => 'overwrite' },
    );
    if (result.isErr()) {
      throw result.error;
    }

    const xml = await readFile(path.join(workspacePath.path, 'result.drawio'), 'utf8');
    assert.strictEqual((xml.match(/shape=image/g) ?? []).length, 3);
    assert.strictEqual((xml.match(/data:image\/png;base64,/g) ?? []).length, 3);
    assert.strictEqual((xml.match(/pageWidth="20" pageHeight="10"/g) ?? []).length, 3);
    assert.strictEqual((xml.match(/<mxGeometry width="20" height="10"/g) ?? []).length, 3);
  });

  it('editable画像（.drawio.png）のDraw.io CLI exportが失敗した場合は出力を作らずエラーのResultを返す', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-to-drawio-failure-'));
    const imagePath = path.join(workspacePath.path, 'image.png');
    await sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
      .png()
      .toFile(imagePath);

    const result = await convertSingleDrawio(
      [sourceAt(workspacePath.path, imagePath)],
      '${fileDirname}/result.drawio.png',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: 'drawio-export-does-not-exist' }),
      { resolveConflicts: async () => 'overwrite' },
    );

    assert.ok(result.isErr(), 'Draw.io CLI export failure should produce an error Result');
    await assert.rejects(readFile(path.join(workspacePath.path, 'result.drawio.png')));
  });
});
