// Test target:
// - editable Draw.io画像をWebPへ変換するとき、Draw.io CLIへWebP/JPEG直接出力を要求せずPDFを経由すること
// - PDFからWebPへ変換するとき、PNGを中間形式に使うこと
//
// Not tested:
// - Draw.io CLI実体での変換
// - PDF renderer実体での変換
// - 画像内容のpixel完全一致

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { executeRasterConversion, rasterFormatSpecs } from '../../src/operations/conversion/raster_conversion.js';
import { requireValue } from '../helpers/required.js';
import { executeDrawio } from '../../src/operations/conversion/tools/drawio_tools.js';

function stubRunPdfToPng(): never {
  throw new Error('PDF to PNG rendering must not run in this test.');
}
suite('GIF・Draw.io画像・PDFをWebPへ変換する処理', () => {
  test('2フレーム・delay[100,250]・loop3のアニメーションGIFをアニメーション設定つきの1jobでWebPへ変換し、pages=2・pageHeight=8・delay・loopのメタデータを保持して出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-webp-animation-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPath = path.join(workspacePath.path, 'source.webp');
    await writeAnimatedGifFixture(sourcePath);

    await executeRasterConversion({
      spec: rasterFormatSpecs.webp,
      maxInputPixels: 1_000_000_000,
      inputs: [
        {
          sourcePath,
          outputPath,
          workspacePath: workspacePath.path,
          animation: { pages: 2, pageHeight: 8, delay: [100, 250], loop: 3 },
        },
      ],
      pdfRenderTools: { runPdfToPng: stubRunPdfToPng },
      mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
      drawioTools: { drawioPath: 'drawio', runDrawio: executeDrawio },
      outputOptions: { effort: 0 },
      runtime: {},
      runId: 'animation-test',
    });

    const metadata = await sharp(outputPath).metadata();
    assert.strictEqual(metadata.pages, 2);
    assert.strictEqual(metadata.pageHeight ?? metadata.height, 8);
    assert.deepStrictEqual(metadata.delay, [100, 250]);
    assert.strictEqual(metadata.loop, 3);
  });

  test('アニメーションとして維持できない画像ではフレーム分割へfallbackせず変換を失敗させ、最終出力を作成せず一時作業ディレクトリを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(os.tmpdir(), 'gw-convert-to-webp-animation-failure-'),
    );

    const sourcePath = path.join(workspacePath.path, 'broken.gif');
    const outputPath = path.join(workspacePath.path, 'broken.webp');
    await writeFile(sourcePath, 'not an image');

    await assert.rejects(
      executeRasterConversion({
        spec: rasterFormatSpecs.webp,
        maxInputPixels: 1_000_000_000,
        inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path, animation: { pages: 2, pageHeight: 8 } }],
        pdfRenderTools: { runPdfToPng: stubRunPdfToPng },
        mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio', runDrawio: executeDrawio },
        outputOptions: { effort: 0 },
        runtime: {},
        runId: 'animation-failure-test',
      }),
    );
    await assert.rejects(readFile(outputPath));
    await assert.rejects(readFile(path.join(workspacePath.path, '.graphics-workbench', 'convert-to-webp')));
  });

  test('編集可能なDraw.io画像をDraw.io CLIで一時作業ディレクトリ内のdrawio.pdfへPDF出力させ、そのPDFを1ページ目PNGへ描画してからWebPへ変換し、各中間出力pathを検証する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-webp-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source', '1.webp');
    const drawioCalls: string[][] = [];
    const pdfToPngCalls: { sourcePath: string; outputPath: string; page: number }[] = [];
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await executeRasterConversion({
      spec: rasterFormatSpecs.webp,
      maxInputPixels: 1_000_000_000,
      inputs: [
        {
          sourcePath,
          outputPath,
          workspacePath: workspacePath.path,
          page: 1,
        },
      ],
      pdfRenderTools: {
        runPdfToPng: async (pdfSourcePath, pngOutputPath, page) => {
          pdfToPngCalls.push({ sourcePath: pdfSourcePath, outputPath: pngOutputPath, page });
          await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff0000' } })
            .png()
            .toFile(pngOutputPath);
        },
      },
      mermaidTools: {
        chromePath: 'chrome',
        mermaidPath: 'mmdc',
        theme: 'default',
        backgroundColor: 'white',
      },
      drawioTools: {
        drawioPath: 'drawio',
        runDrawio: async (_executable, args) => {
          drawioCalls.push(args);
          const outputIndex = args.indexOf('-o') + 1;
          assert.ok(outputIndex > 0);
          await writeFile(requireValue(args[outputIndex]), '%PDF-1.7\n');
        },
      },
      outputOptions: {
        effort: 0,
      },
      runtime: {},
      runId: 'test-run',
    });

    assert.strictEqual(drawioCalls.length, 1);
    const drawioArgs = requireValue(drawioCalls[0]);
    const expectedPdfPath = path.join(
      workspacePath.path,
      '.graphics-workbench',
      'convert-to-webp',
      'test-run',
      '1',
      'drawio.pdf',
    );
    assert.deepStrictEqual(drawioArgs.slice(0, 5), ['-x', '-f', 'pdf', '-o', expectedPdfPath]);
    assert.strictEqual(drawioArgs.at(-1), sourcePath);

    assert.deepStrictEqual(pdfToPngCalls, [
      {
        sourcePath: expectedPdfPath,
        outputPath: path.join(
          workspacePath.path,
          '.graphics-workbench',
          'convert-to-webp',
          'test-run',
          '1',
          'source.png',
        ),
        page: 1,
      },
    ]);

    const buffer = await readFile(outputPath);
    const metadata = await sharp(buffer).metadata();
    assert.strictEqual(metadata.format, 'webp');
    assert.ok(metadata.width);
    assert.ok(metadata.height);
  });
});

async function writeAnimatedGifFixture(filePath: string): Promise<void> {
  const frames = await Promise.all([
    sharp({ create: { width: 12, height: 8, channels: 4, background: '#285078' } })
      .png()
      .toBuffer(),
    sharp({ create: { width: 12, height: 8, channels: 4, background: '#782850' } })
      .png()
      .toBuffer(),
  ]);
  await sharp(frames, { join: { animated: true } })
    .gif({ delay: [100, 250], loop: 3 })
    .toFile(filePath);
}
