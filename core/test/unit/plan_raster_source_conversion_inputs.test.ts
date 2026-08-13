import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { planRasterSourceConversionInputs } from '@graphics-workbench/core/conversion';
import { isEditableDrawioImagePath } from '@graphics-workbench/core/formats';
import { operationPngInputPath } from '@graphics-workbench/core/testing';

suite('ラスター画像を出力テンプレートに従った1ページの変換処理単位（出力パス割当て）へ展開する処理', () => {
  test('PNGのラスター入力をページ1の変換処理単位へ展開し、出力テンプレートからsource-1.jpegの出力パスを生成する', async () => {
    await using temporaryDirectory = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-plan-raster-'));
    const workspacePath = temporaryDirectory.path;

    const sourcePath = path.join(workspacePath, 'source.png');
    await copyFile(operationPngInputPath, sourcePath);

    const jobs = await planRasterSourceConversionInputs({
      sourcePath,
      workspacePath,
      workspaceName: path.basename(workspacePath),
      outputTemplate: '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg',
      allowedExtensions: ['.jpeg'],
      maxInputPixels: 1_000_000_000,
      isEditableDrawioImagePath,
    });

    assert.deepStrictEqual(jobs, [
      {
        sourcePath,
        workspacePath,
        outputPath: path.join(workspacePath, 'source-1.jpeg'),
        page: 1,
      },
    ]);
  });
});
