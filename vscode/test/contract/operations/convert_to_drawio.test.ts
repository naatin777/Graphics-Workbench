import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import {
  convertToDrawioFiles,
  createDrawioXml,
  parseSvgSize,
} from '../../../src/operations/conversion/convert_to_drawio.js';
import { requireValue } from '../../support/helpers/required.js';

suite('複数の入力画像・PDFを1つのDraw.io XMLへ集約する', () => {
  test('XML生成で各画像を1つのshape=imageオブジェクトにし、同名ページをnameとname-2へ連番化する', () => {
    const xml = createDrawioXml([
      { name: 'same', dataUri: 'data:image/png;base64,AA==', width: 10, height: 20 },
      { name: 'same', dataUri: 'data:image/svg+xml;base64,BB==', width: 30, height: 40 },
    ]);
    assert.match(xml, /name="same"/);
    assert.match(xml, /name="same-2"/);
    assert.strictEqual((xml.match(/shape=image/g) ?? []).length, 2);
  });

  test('SVGサイズをwidth/height（ptはpxへ変換）で判定し、片方だけならviewBoxの比率から補完し、両方無ければdimensionsエラーを返す', () => {
    assert.deepStrictEqual(parseSvgSize('<svg width="12pt" height="8pt"/>'), { width: 12, height: 8 });
    assert.deepStrictEqual(parseSvgSize('<svg viewBox="0 0 640 480"/>'), { width: 640, height: 480 });
    assert.deepStrictEqual(parseSvgSize('<svg width="320" viewBox="0 0 640 480"/>'), { width: 320, height: 240 });
    assert.deepStrictEqual(parseSvgSize('<svg height="240" viewBox="0 0 640 480"/>'), { width: 320, height: 240 });
    assert.throws(() => parseSvgSize('<svg/>'), /dimensions/);
  });

  test('PNGと2ページPDFを1つのdrawioへ集約し、PDFの各ページ（1・2）をPDF→SVG変換処理（runPdfToSvg）へ順に通して1ページずつ画像化したXMLを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-to-drawio-'));
    const imagePath = path.join(workspacePath.path, 'image.png');
    const pdfPath = path.join(workspacePath.path, 'input.pdf');
    const outputPath = path.join(workspacePath.path, 'combined.drawio');
    await sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
      .png()
      .toFile(imagePath);
    const { PDFDocument } = await import('../../support/helpers/pdf_document.js');
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 50]);
    pdf.addPage([80, 40]);
    await writeFile(pdfPath, await pdf.save());
    const calls: number[] = [];
    await convertToDrawioFiles({
      maxInputPixels: 1_000_000_000,
      inputs: [
        { inputs: [{ sourcePath: imagePath }, { sourcePath: pdfPath }], outputPath, workspacePath: workspacePath.path },
      ],
      tools: {
        drawioPath: 'drawio',
        runPdfToSvg: async (_source, output, page) => {
          calls.push(page);
          await writeFile(output, '<svg width="100" height="50"/>');
        },
        runDrawio: async () => {
          throw new Error('drawio export must not be used for .drawio output');
        },
      },
      runId: 'test',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });
    const xml = await readFile(outputPath, 'utf8');
    assert.deepStrictEqual(calls, [1, 2]);
    assert.strictEqual((xml.match(/shape=image/g) ?? []).length, 3);
    assert.match(xml, /data:image\/svg\+xml;base64/);
  });

  test('アニメーションGIF/WebP・マルチページTIFFの先頭フレームをPNGデータURIへ正規化し、ページ寸法20x10をXML（pageWidth/pageHeight/mxGeometry）へ設定する', async () => {
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
    for (const [name, format] of inputs) {
      const animatedImage = sharp([red, blue], { join: { animated: true } });
      await animatedImage[format]().toFile(path.join(workspacePath.path, name));
    }

    const outputPath = path.join(workspacePath.path, 'result.drawio');
    await convertToDrawioFiles({
      maxInputPixels: 1_000_000_000,
      inputs: [
        {
          inputs: inputs.map(([name]) => ({ sourcePath: path.join(workspacePath.path, name) })),
          outputPath,
          workspacePath: workspacePath.path,
        },
      ],
      tools: {
        drawioPath: 'drawio',
        runPdfToSvg: async () => {
          throw new Error('pdf input must not be used in this test');
        },
        runDrawio: async () => {
          throw new Error('drawio export must not be used for .drawio output');
        },
      },
      runId: 'raster-frames',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    const xml = await readFile(outputPath, 'utf8');
    assert.strictEqual((xml.match(/shape=image/g) ?? []).length, 3);
    assert.strictEqual((xml.match(/data:image\/png;base64,/g) ?? []).length, 3);
    assert.strictEqual((xml.match(/pageWidth="20" pageHeight="10"/g) ?? []).length, 3);
    assert.strictEqual((xml.match(/<mxGeometry width="20" height="10"/g) ?? []).length, 3);
  });

  test('editableなPNG/SVGを一時Draw.io XMLとしてDesktop CLI（--export --format --embed-diagram）へ渡し、生成されたPNG/SVGを結果ファイルへ反映する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-to-drawio-editable-'));
    const imagePath = path.join(workspacePath.path, 'image.png');
    await sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
      .png()
      .toFile(imagePath);

    for (const extension of ['.dio.png', '.dio.svg']) {
      const outputPath = path.join(workspacePath.path, `result${extension}`);
      let call: { executable: string; args: string[] } | undefined;
      await convertToDrawioFiles({
        maxInputPixels: 1_000_000_000,
        inputs: [{ inputs: [{ sourcePath: imagePath }], outputPath, workspacePath: workspacePath.path }],
        tools: {
          drawioPath: '/custom/drawio',
          runPdfToSvg: async () => {
            throw new Error('pdf input must not be used in this test');
          },
          runDrawio: async (executable, args) => {
            call = { executable, args };
            const generatedOutputPath = requireValue(args[args.indexOf('--output') + 1]);
            if (generatedOutputPath.endsWith('.png')) {
              const png = await sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
                .png()
                .toBuffer();
              await writeFile(generatedOutputPath, Buffer.concat([png, Buffer.from('mxfile')]));
            } else {
              await writeFile(generatedOutputPath, '<svg width="20" height="10"><metadata>mxfile</metadata></svg>');
            }
          },
        },
        runId: extension.slice(1),
        runtime: { resolveConflicts: async () => 'overwrite' },
      });

      assert.strictEqual(call?.executable, '/custom/drawio');
      assert.deepStrictEqual(call?.args.slice(0, 6), [
        '--export',
        '--format',
        extension === '.dio.png' ? 'png' : 'svg',
        '--output',
        path.join(
          workspacePath.path,
          '.graphics-workbench',
          'convert-to-drawio',
          extension.slice(1),
          `result${extension.endsWith('.png') ? '.png' : '.svg'}`,
        ),
        '--embed-diagram',
      ]);
      assert.match(call?.args[6] ?? '', /source\.drawio$/);
      assert.ok((await readFile(outputPath)).length > 0);
    }
  });

  test('editable画像のDraw.io CLI exportが失敗した場合はエラーをそのまま返し、別形式へのfallbackや出力ファイル作成はしない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-to-drawio-failure-'));
    const imagePath = path.join(workspacePath.path, 'image.png');
    const outputPath = path.join(workspacePath.path, 'result.dio.png');
    await sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
      .png()
      .toFile(imagePath);

    await assert.rejects(
      convertToDrawioFiles({
        maxInputPixels: 1_000_000_000,
        inputs: [{ inputs: [{ sourcePath: imagePath }], outputPath, workspacePath: workspacePath.path }],
        tools: {
          drawioPath: 'drawio',
          runPdfToSvg: async () => {
            throw new Error('pdf input must not be used in this test');
          },
          runDrawio: async () => {
            throw new Error('Draw.io export failed');
          },
        },
        runId: 'failure',
        runtime: { resolveConflicts: async () => 'overwrite' },
      }),
      /Draw\.io export failed/,
    );
    await assert.rejects(readFile(outputPath));
  });
});
