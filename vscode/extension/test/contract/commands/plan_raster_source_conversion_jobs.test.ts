import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { planRasterSourceConversionJobs } from '../../../src/commands/conversion/plan_conversion_jobs.js';
import { getDefaultConfiguration } from '../../../src/generated/extension_manifest.js';
import { operationPngInputPath } from '../../support/helpers/fixture_paths.js';
import { requireValue } from '../../support/helpers/required.js';

suite('ラスター画像を出力テンプレートに従った1ページの変換処理単位（出力パス割当て）へ展開する処理', () => {
  test('PNGのラスター入力をページ1の変換処理単位へ展開し、出力テンプレートからsource-1.jpegの出力パスを生成する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspace.uri.fsPath, 'gw-plan-raster-'));

    const sourcePath = path.join(temporaryDirectory.path, 'source.png');
    await copyFile(operationPngInputPath, sourcePath);

    const jobs = await planRasterSourceConversionJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate: '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg',
      allowedExtensions: ['.jpeg'],
      maxInputPixels: getDefaultConfiguration().raster.maxInputPixels(),
    });

    assert.deepStrictEqual(jobs, [
      {
        sourcePath,
        workspacePath: workspace.uri.fsPath,
        outputPath: path.join(temporaryDirectory.path, 'source-1.jpeg'),
        page: 1,
      },
    ]);
  });
});
