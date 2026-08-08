import assert from 'node:assert/strict';
import path from 'node:path';

import {
  planRasterFrameJobsFromMetadata,
  type RasterFramePlanOptions,
} from '../../src/commands/conversion/plan_raster_frame_jobs.js';

const workspacePath = process.platform === 'win32' ? 'C:\\test-workspace' : '/test-workspace';

suite('既知のフレーム枚数からframe jobを生成する処理', () => {
  const options: RasterFramePlanOptions = {
    sourcePath: path.join(workspacePath, 'source.png'),
    workspacePath,
    workspaceName: 'test-workspace',
    outputTemplate: '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg',
    allowedExtensions: ['.jpeg'],
  };

  test('先頭フレームのみを変換する設定では、全4フレームのうちpage 1の変換処理単位を1件だけ生成する', () => {
    const jobs = planRasterFrameJobsFromMetadata(options, { pages: 4, width: 10, pageHeight: 10 });

    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0]?.page, 1);
  });

  test('全フレームを変換する設定では、4フレームの変換処理単位を4件生成し、最後の出力パスがsource-4.jpegになる', () => {
    const jobs = planRasterFrameJobsFromMetadata(
      { ...options, frameMode: 'all' },
      { pages: 4, width: 10, pageHeight: 10 },
    );

    assert.strictEqual(jobs.length, 4);
    assert.strictEqual(jobs[3]?.outputPath, path.join(workspacePath, 'source-4.jpeg'));
  });

  test('フレーム枚数が0で取得できない場合は"Could not determine image frame count"エラーを投げ、変換処理単位を1件も生成しない', () => {
    assert.throws(
      () => planRasterFrameJobsFromMetadata(options, { pages: 0, width: 0, pageHeight: 0 }),
      /Could not determine image frame count/,
    );
  });
});
