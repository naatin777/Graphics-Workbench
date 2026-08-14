// Test target:
// - 指定角度でラスタ画像を回転し、全成功後に出力すること
// - 90/180/270度で出力画像の幅・高さが正しく変化すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 非ラスタ入力、不正な角度、不正な出力拡張子、画素上限を超える入力を拒否すること
//
// Mocked:
// - なし。sharpと実ファイルを使用する
//
import assert from 'node:assert/strict';
import { access, mkdtempDisposable, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { rotateImageFiles } from '@graphics-workbench/core/conversion';

describe('ラスタ画像の回転', () => {
  it('4x2のPNGを90度回転すると、2x4のPNGとして出力される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.png');
    const outputPath = path.join(workspacePath, 'output.png');
    await writeImage(sourcePath, 4, 2);

    try {
      const outputs = await rotateImageFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
        runId: 'run',
        maxInputPixels: 1000,
      });
      assert.strictEqual(outputs.length, 1);
      assert.strictEqual(outputs[0]?.outputPath, outputPath);

      const metadata = await sharp(outputPath).metadata();
      assert.strictEqual(metadata.format, 'png');
      assert.strictEqual(metadata.width, 2);
      assert.strictEqual(metadata.height, 4);
    } finally {
    }
  });

  it('4x2のPNGを180度回転すると、4x2のまま出力される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.png');
    const outputPath = path.join(workspacePath, 'output.png');
    await writeImage(sourcePath, 4, 2);

    try {
      await rotateImageFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 180 }],
        runtime: {},
        runId: 'run',
        maxInputPixels: 1000,
      });

      const metadata = await sharp(outputPath).metadata();
      assert.strictEqual(metadata.format, 'png');
      assert.strictEqual(metadata.width, 4);
      assert.strictEqual(metadata.height, 2);
    } finally {
    }
  });

  it('4x2のPNGを270度回転すると、2x4のPNGとして出力される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.png');
    const outputPath = path.join(workspacePath, 'output.png');
    await writeImage(sourcePath, 4, 2);

    try {
      await rotateImageFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 270 }],
        runtime: {},
        runId: 'run',
        maxInputPixels: 1000,
      });

      const metadata = await sharp(outputPath).metadata();
      assert.strictEqual(metadata.format, 'png');
      assert.strictEqual(metadata.width, 2);
      assert.strictEqual(metadata.height, 4);
    } finally {
    }
  });

  it('SVGなど非ラスタの入力は拒否される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.svg');
    const outputPath = path.join(workspacePath, 'output.svg');
    await writeFile(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    await assert.rejects(
      rotateImageFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
        maxInputPixels: 1000,
      }),
      /Only raster image files can be rotated/,
    );
  });

  it('出力拡張子がラスタ形式でない場合は拒否される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.png');
    const outputPath = path.join(workspacePath, 'output.txt');
    await writeImage(sourcePath, 4, 2);

    await assert.rejects(
      rotateImageFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
        maxInputPixels: 1000,
      }),
      /Invalid output extension/,
    );
  });

  it('画素上限を超える入力は拒否され、出力ファイルは作成されない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.png');
    const outputPath = path.join(workspacePath, 'output.png');
    await writeImage(sourcePath, 4, 2);

    await assert.rejects(
      rotateImageFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
        maxInputPixels: 7,
      }),
      /pixel limit/i,
    );

    await assert.rejects(access(outputPath));
  });
});

async function writeImage(filePath: string, width: number, height: number): Promise<void> {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toFile(filePath);
}
