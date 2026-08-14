// Test target:
// - アニメーションGIFをWebPへ変換するとき、アニメーション設定（pages・delay・loop）を保持すること
// - アニメーションとして維持できない破損GIFは変換せず、出力や一時作業ディレクトリを作らないこと
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

import { convertSingleWebp } from '@graphics-workbench/core/conversion';
import { testConversionConfiguration } from '@graphics-workbench/core/testing';

describe('GIF・Draw.io画像・PDFをWebPへ変換する処理', () => {
  it('2フレーム・delay[100,250]・loop3のアニメーションGIFをアニメーション設定つきでWebPへ変換し、pages=2・pageHeight=8・delay・loopのメタデータを保持して出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-webp-animation-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPath = path.join(workspacePath.path, 'source.webp');
    await writeAnimatedGifTestData(sourcePath);

    const result = await convertSingleWebp(
      [{ sourcePath, workspacePath: workspacePath.path, workspaceName: path.basename(workspacePath.path) }],
      '${fileDirname}/source.webp',
      testConversionConfiguration({
        maxInputPixels: 1_000_000_000,
        maxAnimationPixels: 1_000_000_000,
        webpEffort: 0,
      }),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    const metadata = await sharp(outputPath).metadata();
    assert.strictEqual(metadata.pages, 2);
    assert.strictEqual(metadata.pageHeight ?? metadata.height, 8);
    assert.deepStrictEqual(metadata.delay, [100, 250]);
    assert.strictEqual(metadata.loop, 3);
  });

  it('アニメーションとして維持できない破損GIFでは変換を失敗させ、最終出力を作成せず一時作業ディレクトリも作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(os.tmpdir(), 'gw-convert-to-webp-animation-failure-'),
    );

    const sourcePath = path.join(workspacePath.path, 'broken.gif');
    const outputPath = path.join(workspacePath.path, 'broken.webp');
    await writeFile(sourcePath, 'not an image');

    const result = await convertSingleWebp(
      [{ sourcePath, workspacePath: workspacePath.path, workspaceName: path.basename(workspacePath.path) }],
      '${fileDirname}/broken.webp',
      testConversionConfiguration({
        maxInputPixels: 1_000_000_000,
        maxAnimationPixels: 1_000_000_000,
        webpEffort: 0,
      }),
      {},
    );

    assert.ok(result.isErr(), 'broken GIF conversion should fail');
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
