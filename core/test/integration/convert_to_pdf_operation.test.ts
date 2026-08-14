// Test target:
// - PNG/GIF/TIFFをPDFに変換する機能
// - アニメーションGIFは全フレームを1つのPDFへ統合する
// - 入力画像のpixel上限を超えると変換せず、ResultのErrを返す
// - Draw.io入力は変換せず、ResultのErrを返す
// - SVGをPDFへ変換する
//
// Not tested:
// - 外部CLIの実体（oracles側で確認）
// - Draw.io CLIの内部引数（内部実装詳細）

import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import {
  operationPngInputPath,
  testInputDirectory,
  readPdfPages,
  testConversionConfiguration,
} from '@graphics-workbench/core/testing';
import { convertSinglePdf } from '@graphics-workbench/core/conversion';

function workspaceContext(workspacePath: string) {
  return {
    workspacePath,
    workspaceName: path.basename(workspacePath),
  };
}

describe('入力画像をPDFへ変換する処理', () => {
  it('アニメーションGIFを1つのPDFへ統合し、全フレームをページとして保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-gif-to-pdf-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    await writeAnimatedGif(sourcePath);

    const result = await convertSinglePdf(
      [{ sourcePath, ...workspaceContext(workspacePath.path) }],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000 }),
      {},
    );

    assert.ok(result.isOk());
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const pdfPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(pdfPages.length, 2);
  });

  it('ページ寸法が異なる4ページTIFFを全ページPDFへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-tiff-to-pdf-'));

    const sourcePath = path.join(workspacePath.path, 'source.tiff');
    await copyFile(path.join(testInputDirectory, 'valid', 'tiff', 'heatmap.tiff'), sourcePath);

    const result = await convertSinglePdf(
      [{ sourcePath, ...workspaceContext(workspacePath.path) }],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000 }),
      {},
    );

    assert.ok(result.isOk());
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const pdfPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(pdfPages.length, 4);
  });

  it('PNGを読み込んで1ページのPDFへ変換し、出力PDFのページ数が1であることを確認する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-png-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.png');
    await copyFile(operationPngInputPath, sourcePath);

    const result = await convertSinglePdf(
      [{ sourcePath, ...workspaceContext(workspacePath.path) }],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000 }),
      {},
    );

    assert.ok(result.isOk());
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const pdfBytes = await readFile(outputPath);
    assert.strictEqual((await readPdfPages(pdfBytes)).length, 1);
  });

  it('10x10のPNGに対しmaxInputPixels=99ではpixel上限エラーでResultのErrを返し、maxInputPixels=100では変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-png-pixel-limit-'));
    const sourcePath = path.join(workspacePath.path, 'ten-by-ten.png');
    await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 32, g: 64, b: 96, alpha: 1 },
      },
    })
      .png()
      .toFile(sourcePath);

    const limited = await convertSinglePdf(
      [{ sourcePath, ...workspaceContext(workspacePath.path) }],
      '${fileDirname}/limited.pdf',
      testConversionConfiguration({ maxInputPixels: 99 }),
      {},
    );
    assert.ok(limited.isErr());
    assert.match(limited.error.message, /pixel limit|Configured limit|Input image exceeds pixel limit/u);

    const ok = await convertSinglePdf(
      [{ sourcePath, ...workspaceContext(workspacePath.path) }],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({ maxInputPixels: 100 }),
      {},
    );
    assert.ok(ok.isOk());
    await readFile(path.join(workspacePath.path, 'output.pdf'));
  });

  it('Draw.io backend未設定のeditable Draw.io画像はDraw.io executable未設定エラーでResultのErrを返す', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-no-drawio-'));
    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    await copyFile(path.join(testInputDirectory, 'valid', 'drawio', 'multi-object-diagram.drawio.png'), sourcePath);

    const result = await convertSinglePdf(
      [{ sourcePath, ...workspaceContext(workspacePath.path) }],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: '' }),
      {},
    );

    assert.ok(result.isErr());
    assert.match(result.error.message, /Draw\.io executable is not configured/u);
  });
});

async function writeAnimatedGif(filePath: string): Promise<void> {
  const red = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer();
  const blue = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#0000ff' } })
    .png()
    .toBuffer();
  await sharp([red, blue], { join: { animated: true } })
    .gif()
    .toFile(filePath);
}
