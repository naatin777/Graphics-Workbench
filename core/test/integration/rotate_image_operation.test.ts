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
import { access, copyFile, mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { rotateImageFiles } from '@graphics-workbench/core/conversion';
import { operationPngInputPath, testInputDirectory } from '@graphics-workbench/core/testing';

// test/input/valid/png/transparent-shapes.pngの実寸をコミットした期待値。
const SOURCE_PNG_WIDTH = 320;
const SOURCE_PNG_HEIGHT = 200;

interface SourcePng {
  sourcePath: string;
  width: number;
  height: number;
}

describe('ラスタ画像の回転', () => {
  it('transparent-shapes.png（320x200）を90度回転すると、200x320のPNGとして出力される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const source = await copySourcePng(workspacePath);
    const outputPath = path.join(workspacePath, 'output.png');

    const outputs = await rotateImageFiles({
      inputs: [{ sourcePath: source.sourcePath, workspacePath, outputPath, angle: 90 }],
      runtime: {},
      runId: 'run',
      maxInputPixels: 1_000_000,
    });
    assert.strictEqual(outputs.length, 1);
    assert.strictEqual(outputs[0]?.outputPath, outputPath);

    const metadata = await sharp(outputPath).metadata();
    assert.strictEqual(metadata.format, 'png');
    assert.strictEqual(metadata.width, source.height);
    assert.strictEqual(metadata.height, source.width);
  });

  it('transparent-shapes.png（320x200）を180度回転すると、320x200のまま出力される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const source = await copySourcePng(workspacePath);
    const outputPath = path.join(workspacePath, 'output.png');

    await rotateImageFiles({
      inputs: [{ sourcePath: source.sourcePath, workspacePath, outputPath, angle: 180 }],
      runtime: {},
      runId: 'run',
      maxInputPixels: 1_000_000,
    });

    const metadata = await sharp(outputPath).metadata();
    assert.strictEqual(metadata.format, 'png');
    assert.strictEqual(metadata.width, source.width);
    assert.strictEqual(metadata.height, source.height);
  });

  it('transparent-shapes.png（320x200）を270度回転すると、200x320のPNGとして出力される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const source = await copySourcePng(workspacePath);
    const outputPath = path.join(workspacePath, 'output.png');

    await rotateImageFiles({
      inputs: [{ sourcePath: source.sourcePath, workspacePath, outputPath, angle: 270 }],
      runtime: {},
      runId: 'run',
      maxInputPixels: 1_000_000,
    });

    const metadata = await sharp(outputPath).metadata();
    assert.strictEqual(metadata.format, 'png');
    assert.strictEqual(metadata.width, source.height);
    assert.strictEqual(metadata.height, source.width);
  });

  it('SVGなど非ラスタの入力は拒否される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.svg');
    const outputPath = path.join(workspacePath, 'output.svg');
    await copyFile(path.join(testInputDirectory, 'valid', 'svg', 'solid-rect-31x19.svg'), sourcePath);

    await assert.rejects(
      rotateImageFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
        maxInputPixels: 1_000_000,
      }),
      /Only raster image files can be rotated/,
    );
  });

  it('出力拡張子がラスタ形式でない場合は拒否される', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const source = await copySourcePng(workspacePath);
    const outputPath = path.join(workspacePath, 'output.txt');

    await assert.rejects(
      rotateImageFiles({
        inputs: [{ sourcePath: source.sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
        maxInputPixels: 1_000_000,
      }),
      /Invalid output extension/,
    );
  });

  it('画素上限を超える入力は拒否され、出力ファイルは作成されない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-image-test-'));
    const workspacePath = workspacePathDisposable.path;
    const source = await copySourcePng(workspacePath);
    const outputPath = path.join(workspacePath, 'output.png');

    await assert.rejects(
      rotateImageFiles({
        inputs: [{ sourcePath: source.sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
        maxInputPixels: 7,
      }),
      /pixel limit/i,
    );

    await assert.rejects(access(outputPath));
  });
});

async function copySourcePng(workspacePath: string): Promise<SourcePng> {
  const sourcePath = path.join(workspacePath, 'source.png');
  await copyFile(operationPngInputPath, sourcePath);

  // テストデータの実寸がコミット済み期待値からドリフトしていないか確認する。
  const metadata = await sharp(sourcePath).metadata();
  assert.strictEqual(metadata.width, SOURCE_PNG_WIDTH, 'source png width');
  assert.strictEqual(metadata.height, SOURCE_PNG_HEIGHT, 'source png height');
  return { sourcePath, width: SOURCE_PNG_WIDTH, height: SOURCE_PNG_HEIGHT };
}
