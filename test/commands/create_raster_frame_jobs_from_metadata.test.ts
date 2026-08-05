import assert from 'node:assert/strict';
import path from 'node:path';

import {
  createRasterFrameJobsFromMetadata,
  type RasterFrameJobSource,
} from '../../src/commands/conversion/create_raster_frame_jobs.js';

const workspacePath = process.platform === 'win32' ? 'C:\\test-workspace' : '/test-workspace';

suite('ラスターframe job純粋planner', () => {
  const options: RasterFrameJobSource = {
    sourcePath: path.join(workspacePath, 'source.png'),
    workspacePath,
    workspaceName: 'test-workspace',
    outputTemplate: '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg',
    allowedExtensions: ['.jpeg'],
    createJob: (job) => job,
  };

  test('frame mode firstでは先頭pageだけを生成する', () => {
    const jobs = createRasterFrameJobsFromMetadata(options, { pages: 4, width: 10, pageHeight: 10 });

    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0]?.page, 1);
  });

  test('frame mode allでは全frameを生成する', () => {
    const jobs = createRasterFrameJobsFromMetadata(
      { ...options, frameMode: 'all' },
      { pages: 4, width: 10, pageHeight: 10 },
    );

    assert.strictEqual(jobs.length, 4);
    assert.strictEqual(jobs[3]?.outputPath, path.join(workspacePath, 'source-4.jpeg'));
  });

  test('frame countが取得できない場合は拒否する', () => {
    assert.throws(
      () => createRasterFrameJobsFromMetadata(options, { pages: 0, width: 0, pageHeight: 0 }),
      /Could not determine image frame count/,
    );
  });
});
