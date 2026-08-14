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

import { executeDrawio, executeRasterConversion, rasterFormatSpecs } from '@graphics-workbench/core/conversion';

function stubRunPdfToPng(): never {
  throw new Error('PDF to PNG rendering must not run in this test.');
}
describe('GIF・Draw.io画像・PDFをWebPへ変換する処理', () => {
  it('2フレーム・delay[100,250]・loop3のアニメーションGIFをアニメーション設定つきの1jobでWebPへ変換し、pages=2・pageHeight=8・delay・loopのメタデータを保持して出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-webp-animation-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPath = path.join(workspacePath.path, 'source.webp');
    await writeAnimatedGifTestData(sourcePath);

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

  it('アニメーションとして維持できない画像ではフレーム分割へfallbackせず変換を失敗させ、最終出力を作成せず一時作業ディレクトリを削除する', async () => {
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
        drawioTools: { drawioPath: 'drawio', runDrawio: executeDrawio },
        outputOptions: { effort: 0 },
        runtime: {},
        runId: 'animation-failure-test',
      }),
    );
    await assert.rejects(readFile(outputPath));
    await assert.rejects(readFile(path.join(workspacePath.path, '.graphics-workbench', 'convert-to-webp')));
  });
});

async function writeAnimatedGifTestData(filePath: string): Promise<void> {
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
