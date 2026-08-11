// Test target:
// - ラスタ画像をsharpで再エンコードして圧縮する処理
// - JPEG / WebP / AVIFはquality設定で非可逆再圧縮
// - PNGはlossless最適化で再圧縮
// - アニメーションGIFはフレーム設定を保持して再圧縮
// - 非対応入力は変換を失敗させ、最終出力とstaging artifactを作成しない
//
// Not tested:
// - Safe Modeダイアログの画面表示
// - キャンセル後の挙動
// - 画像内容のpixel完全一致

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempDisposable, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { compressImageFiles } from '../../src/operations/conversion/compress_image.js';
import { operationPngInputPath } from '../helpers/fixture_paths.js';

suite('画像圧縮処理', () => {
  test('JPEG入力をqualityで再圧縮し、読み込み可能なより小さなJPEGを出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-compress-image-'));

    const sourcePath = path.join(workspacePath.path, 'source.jpg');
    const outputPath = path.join(workspacePath.path, 'source_compressed.jpg');
    await sharp(await readFile(operationPngInputPath))
      .jpeg({ quality: 100 })
      .toFile(sourcePath);

    await compressImageFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      quality: 30,
      maxInputPixels: 1_000_000_000,
      runtime: {},
      runId: 'compress-image-test',
    });

    const metadata = await sharp(await readFile(outputPath)).metadata();
    assert.strictEqual(metadata.format, 'jpeg');
    assert.ok(metadata.width && metadata.width > 0);
    assert.ok(metadata.height && metadata.height > 0);
    assert.ok((await stat(outputPath)).size < (await stat(sourcePath)).size);
  });

  test('PNG入力をlossless最適化で再圧縮し、読み込み可能なPNGを出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-compress-image-'));

    const sourcePath = path.join(workspacePath.path, 'source.png');
    const outputPath = path.join(workspacePath.path, 'source_compressed.png');
    const pixelBuffer = randomBytes(256 * 256 * 3);
    await sharp(pixelBuffer, { raw: { width: 256, height: 256, channels: 3 } })
      .png()
      .toFile(sourcePath);

    await compressImageFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      quality: 80,
      maxInputPixels: 1_000_000_000,
      runtime: {},
      runId: 'compress-png-test',
    });

    const metadata = await sharp(await readFile(outputPath)).metadata();
    assert.strictEqual(metadata.format, 'png');
    assert.ok(metadata.width && metadata.width > 0);
    assert.ok(metadata.height && metadata.height > 0);
  });

  test('アニメーションGIFをフレーム設定を保持して再圧縮し、pages=2・delay・loopのメタデータを保持して出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-compress-image-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPath = path.join(workspacePath.path, 'source_compressed.gif');
    await writeAnimatedGifFixture(sourcePath);

    await compressImageFiles({
      inputs: [
        {
          sourcePath,
          outputPath,
          workspacePath: workspacePath.path,
          animation: { pages: 2, pageHeight: 8, delay: [100, 250], loop: 3 },
        },
      ],
      quality: 80,
      maxInputPixels: 1_000_000_000,
      runtime: {},
      runId: 'compress-gif-test',
    });

    const metadata = await sharp(await readFile(outputPath)).metadata();
    assert.strictEqual(metadata.format, 'gif');
    assert.strictEqual(metadata.pages, 2);
    assert.strictEqual(metadata.pageHeight ?? metadata.height, 8);
    assert.deepStrictEqual(metadata.delay, [100, 250]);
    assert.strictEqual(metadata.loop, 3);
  });

  test('非対応入力では変換を失敗させ、最終出力を作成せず一時作業ディレクトリを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-compress-image-failure-'));

    const sourcePath = path.join(workspacePath.path, 'source.txt');
    const outputPath = path.join(workspacePath.path, 'source_compressed.txt');
    await writeFile(sourcePath, 'not an image');

    await assert.rejects(
      compressImageFiles({
        inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
        quality: 80,
        maxInputPixels: 1_000_000_000,
        runtime: {},
        runId: 'compress-image-failure-test',
      }),
    );
    await assert.rejects(readFile(outputPath));
    await assert.rejects(readFile(path.join(workspacePath.path, '.graphics-workbench', 'compress-image')));
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
