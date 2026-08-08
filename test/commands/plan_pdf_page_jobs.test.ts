import assert from 'node:assert/strict';
import path from 'node:path';

import { planPdfPageJobs } from '../../src/commands/conversion/plan_pdf_page_jobs.js';

const workspacePath = process.platform === 'win32' ? 'C:\\test-workspace' : '/test-workspace';

suite('PDFページjob純粋planner', () => {
  const source = {
    sourcePath: path.join(workspacePath, 'source.pdf'),
    workspacePath,
    workspaceName: 'test-workspace',
  };

  test('page countからpageごとのjobを展開する', () => {
    const jobs = planPdfPageJobs(source, 2, '${fileDirname}/${fileBasenameNoExtension}-${page}.png', ['.png']);

    assert.deepStrictEqual(
      jobs.map(({ page, outputPath }) => ({ page, outputPath })),
      [
        { page: 1, outputPath: path.join(workspacePath, 'source-1.png') },
        { page: 2, outputPath: path.join(workspacePath, 'source-2.png') },
      ],
    );
  });

  test('複数ページのtemplateに${page}がない場合は拒否する', () => {
    assert.throws(
      () => planPdfPageJobs(source, 2, '${fileDirname}/${fileBasenameNoExtension}.png', ['.png']),
      /Split output for multiple pages or frames requires \$\{page\} in the output path\./,
    );
  });

  test('page countが0のPDFは拒否する', () => {
    assert.throws(
      () => planPdfPageJobs(source, 0, '${fileDirname}/${fileBasenameNoExtension}-${page}.png', ['.png']),
      new RegExp(`PDF has no pages: ${RegExp.escape(source.sourcePath)}`),
    );
  });
});
