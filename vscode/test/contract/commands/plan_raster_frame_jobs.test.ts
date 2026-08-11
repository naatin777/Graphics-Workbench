import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { planRasterFrameJobs } from '../../../src/commands/conversion/plan_raster_frame_jobs.js';
import { getDefaultConfiguration } from '../../../src/generated/extension_manifest.js';
import { operationPngInputPath } from '../../support/helpers/fixture_paths.js';

const fixturePath = operationPngInputPath;

suite('ラスター画像から出力テンプレートに従った変換処理単位を生成する処理の出力パス検証', () => {
  test('出力templateの拡張子が.jpegで許容拡張子が.pngのみの場合、"Invalid output extension"エラーで変換前に拒否する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-frame-jobs-'));
    const sourcePath = path.join(workspacePath.path, 'source.png');

    await copyFile(fixturePath, sourcePath);
    await assert.rejects(
      planRasterFrameJobs({
        sourcePath,
        workspacePath: workspacePath.path,
        workspaceName: path.basename(workspacePath.path),
        outputTemplate: '${fileDirname}/${fileBasenameNoExtension}.jpeg',
        allowedExtensions: ['.png'],
        maxInputPixels: getDefaultConfiguration().raster.maxInputPixels(),
      }),
      /Invalid output extension/,
    );
  });

  test('出力templateの拡張子が.pngで許容拡張子が.pngの場合、変換処理単位を1件生成し出力パスの拡張子が.pngになる', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-frame-jobs-'));
    const sourcePath = path.join(workspacePath.path, 'source.png');

    await copyFile(fixturePath, sourcePath);
    const jobs = await planRasterFrameJobs({
      sourcePath,
      workspacePath: workspacePath.path,
      workspaceName: path.basename(workspacePath.path),
      outputTemplate: '${fileDirname}/${fileBasenameNoExtension}.png',
      allowedExtensions: ['.png'],
      maxInputPixels: getDefaultConfiguration().raster.maxInputPixels(),
    });

    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(path.extname(jobs[0]?.outputPath ?? ''), '.png');
  });
});
