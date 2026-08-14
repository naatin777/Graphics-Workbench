// Test target:
// - 編集可能なDraw.io画像（.drawio.png / .drawio.svg）を高レベルAPIで1ページ目PNGへ変換できる
//
// Mocked:
// - なし（実Draw.io CLIを使うため test:external ジョブで実行される）

import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { convertSinglePng, type ConversionConfiguration } from '@graphics-workbench/core/conversion';
import {
  requireConfiguredTool,
  testConversionConfiguration,
  testInputDirectory,
} from '@graphics-workbench/core/testing';

function configuredDrawio(): ConversionConfiguration {
  return testConversionConfiguration({
    maxInputPixels: 1_000_000_000,
    drawioPath: requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io'),
  });
}

describe('実Draw.io CLIによるDraw.io画像のPNG変換', () => {
  it('編集可能なDraw.io PNGを1ページ目PNGへ変換し、読み取り可能なPNGを出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-png-real-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    await copyFile(path.join(testInputDirectory, 'valid', 'drawio', 'multi-object-diagram.drawio.png'), sourcePath);

    const result = await convertSinglePng(
      [{ sourcePath, workspacePath: workspacePath.path, workspaceName: path.basename(workspacePath.path) }],
      '${fileDirname}/${fileBasenameNoExtension}.png',
      configuredDrawio(),
      { resolveConflicts: async () => 'overwrite' },
    );
    if (result.isErr()) {
      throw result.error;
    }

    const outputPath = path.join(workspacePath.path, 'source.png');
    assert.deepStrictEqual(
      result.value.map(({ outputPath: committedPath }) => committedPath),
      [outputPath],
    );
    const metadata = await sharp(await readFile(outputPath)).metadata();
    assert.strictEqual(metadata.format, 'png');
    assert.ok(metadata.width);
    assert.ok(metadata.width > 0);
    assert.ok(metadata.height);
    assert.ok(metadata.height > 0);
  });
});
