import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRasterFrameJobs } from '../../src/commands/conversion/create_raster_frame_jobs.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { operationPngInputPath } from '../helpers/fixture_paths.js';

const fixturePath = operationPngInputPath;

suite('ラスター分割jobの出力path検証', () => {
  test('コマンドの許容拡張子と一致しないtemplateを変換前に拒否する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-frame-jobs-'));
    const sourcePath = path.join(workspacePath.path, 'source.png');

    await copyFile(fixturePath, sourcePath);
    await assert.rejects(
      createRasterFrameJobs({
        sourcePath,
        workspacePath: workspacePath.path,
        workspaceName: path.basename(workspacePath.path),
        outputTemplate: '${fileDirname}/${fileBasenameNoExtension}.jpeg',
        allowedExtensions: ['.png'],
        maxInputPixels: getDefaultConfiguration().raster.maxInputPixels(),
        createJob: (job) => job,
      }),
      /Invalid output extension/,
    );
  });

  test('許容拡張子と一致するtemplateからjobを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-frame-jobs-'));
    const sourcePath = path.join(workspacePath.path, 'source.png');

    await copyFile(fixturePath, sourcePath);
    const jobs = await createRasterFrameJobs({
      sourcePath,
      workspacePath: workspacePath.path,
      workspaceName: path.basename(workspacePath.path),
      outputTemplate: '${fileDirname}/${fileBasenameNoExtension}.png',
      allowedExtensions: ['.png'],
      maxInputPixels: getDefaultConfiguration().raster.maxInputPixels(),
      createJob: (job) => job,
    });

    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(path.extname(jobs[0]?.outputPath ?? ''), '.png');
  });
});
