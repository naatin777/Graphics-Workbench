// Test target:
// - アニメーション画像（GIF/WebP/TIFF）をフレームごとのPNGへ変換する

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { convertSplitPng } from '@graphics-workbench/core/conversion';
import { testConversionConfiguration } from '@graphics-workbench/core/testing';

describe('アニメーション画像をフレームごとのPNGへ変換する処理', () => {
  it('GIF・アニメーションWebP・TIFFの2フレームをフレームごとの個別PNGへ変換し、1フレーム目は赤系・2フレーム目は青系の内容のPNGを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-png-frames-'));

    for (const format of ['gif', 'webp', 'tiff'] as const) {
      const sourcePath = path.join(workspacePath.path, `source.${format}`);
      await writeAnimatedRaster(sourcePath, format);
      const result = await convertSplitPng(
        [{ sourcePath, workspacePath: workspacePath.path, workspaceName: path.basename(workspacePath.path) }],
        '${fileDirname}/${fileBasenameNoExtension}-${page}.png',
        testConversionConfiguration({ maxInputPixels: 1_000_000_000 }),
        { resolveConflicts: async () => 'overwrite' },
      );
      assert.ok(result.isOk(), `conversion failed: ${result.isErr() ? result.error.message : ''}`);

      assert.ok(
        requireValue((await sharp(await readFile(path.join(workspacePath.path, `source-1.png`))).stats()).channels[0])
          .mean > 200,
      );
      assert.ok(
        requireValue((await sharp(await readFile(path.join(workspacePath.path, `source-2.png`))).stats()).channels[2])
          .mean > 200,
      );
    }
  });
});

async function writeAnimatedRaster(filePath: string, format: 'gif' | 'webp' | 'tiff'): Promise<void> {
  const red = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer();
  const blue = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#0000ff' } })
    .png()
    .toBuffer();
  const output = sharp([red, blue], { join: { animated: true } });
  await (format === 'gif' ? output.gif() : format === 'webp' ? output.webp() : output.tiff()).toFile(filePath);
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a defined value.');
  }
  return value;
}
