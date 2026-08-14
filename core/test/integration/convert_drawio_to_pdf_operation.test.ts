import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtempDisposable, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { testConversionConfiguration, testInputDirectory } from '@graphics-workbench/core/testing';

import { convertSinglePdf, convertSplitPdf } from '@graphics-workbench/core/conversion';

const drawioTestDataPath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');
const emptyDrawioTestDataPath = path.join(testInputDirectory, 'valid', 'drawio', 'empty.drawio');

function source(workspacePath: string, sourcePath: string) {
  return {
    sourcePath,
    workspacePath,
    workspaceName: path.basename(workspacePath),
  };
}

describe('Draw.ioファイルをPDFへ変換する際の入力検証', () => {
  it('コンテンツのないDraw.ioファイルはCLIを起動せず「no content to export」エラーを返し、出力PDFも作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-empty-'));

    const sourcePath = path.join(workspacePath.path, 'empty.drawio');
    await copyFile(emptyDrawioTestDataPath, sourcePath);

    const result = await convertSinglePdf(
      [source(workspacePath.path, sourcePath)],
      '${fileDirname}/empty.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: 'drawio' }),
      { resolveConflicts: async () => 'overwrite' },
    );

    assert.ok(result.isErr(), 'empty Draw.io file conversion should fail');
    assert.match(result.error.message, /no content to export/u);
    assert.strictEqual(existsSync(path.join(workspacePath.path, 'empty.pdf')), false);
  });

  it('split出力のoutput templateに${page}が含まれない場合は、CLI実行前にエラーを返す', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-page-var-'));

    const sourcePath = path.join(workspacePath.path, 'q a.drawio');
    await copyFile(drawioTestDataPath, sourcePath);

    const result = await convertSplitPdf(
      [source(workspacePath.path, sourcePath)],
      '${fileDirname}/all-pages.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: 'drawio' }),
      { resolveConflicts: async () => 'overwrite' },
    );

    assert.ok(result.isErr(), 'split output template without ${page} should fail');
    assert.match(result.error.message, /must contain \$\{page\}/u);
  });

  it('画像として読み取れない入力はエラーで拒否し、出力PDFを作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-not-drawio-'));

    const sourcePath = path.join(workspacePath.path, 'diagram.png');
    await writeFile(sourcePath, 'not a drawio file');

    const result = await convertSinglePdf(
      [source(workspacePath.path, sourcePath)],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: 'drawio' }),
      { resolveConflicts: async () => 'overwrite' },
    );

    assert.ok(result.isErr(), 'unreadable input should fail');
    assert.match(result.error.message, /unsupported image format/u);
  });
});
