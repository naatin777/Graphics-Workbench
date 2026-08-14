// Test target:
// - PDFをSVGへ変換し、SVGとして読み取れる出力をcommitすること
// - Draw.io CLIの起動がspawn ENOENTで失敗すると、Draw.io CLI failedエラーに包んで変換を失敗させること
//
// Not tested:
// - Draw.io CLI実体での変換（external oracles側で確認）
// - external toolの不正な出力内容のrejection（内部実装詳細は新APIで隠蔽）

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPdfTestData, testConversionConfiguration, testInputDirectory } from '@graphics-workbench/core/testing';

import { convertSingleSvg } from '@graphics-workbench/core/conversion';

describe('Draw.io画像とPDFをSVGへ変換する処理', () => {
  it('PDFをSVGへ変換し、SVGとして読み取れる出力を生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const pdfBytes = await createPdfTestData({ pages: [{ mediaBox: [0, 0, 300, 200] }] });
    await writeFile(sourcePath, pdfBytes);

    const result = await convertSingleSvg(
      [{ sourcePath, workspacePath: workspacePath.path, workspaceName: path.basename(workspacePath.path) }],
      '${fileDirname}/output.svg',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: 'drawio' }),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    const svg = await readFile(path.join(workspacePath.path, 'output.svg'), 'utf8');
    assert.match(svg, /<svg[\s>]/u);
  });

  it('Draw.io CLIの起動がspawn ENOENTで失敗すると、Draw.io CLI failedエラーに包んで変換を失敗させる', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-spawn-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    await copyFile(path.join(testInputDirectory, 'valid', 'drawio', 'multi-object-diagram.drawio.png'), sourcePath);

    const result = await convertSingleSvg(
      [{ sourcePath, workspacePath: workspacePath.path, workspaceName: path.basename(workspacePath.path) }],
      '${fileDirname}/output.svg',
      testConversionConfiguration({
        maxInputPixels: 1_000_000_000,
        drawioPath: 'drawio-executable-does-not-exist',
      }),
      {},
    );

    assert.ok(result.isErr(), 'Draw.io CLI spawn failure should produce an error Result');
    assert.match(result.error.message, /Draw\.io CLI failed:.*drawio-executable-does-not-exist/u);
    await assert.rejects(readFile(path.join(workspacePath.path, 'output.svg')));
  });
});
