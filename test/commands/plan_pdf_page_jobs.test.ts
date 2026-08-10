import assert from 'node:assert/strict';
import path from 'node:path';

import { planPdfPageJobs } from '../../src/commands/conversion/plan_conversion_jobs.js';

const workspacePath = process.platform === 'win32' ? 'C:\\test-workspace' : '/test-workspace';

suite('ページ数と出力テンプレートからPDFページごとの出力パスを生成する処理', () => {
  const source = {
    sourcePath: path.join(workspacePath, 'source.pdf'),
    workspacePath,
    workspaceName: 'test-workspace',
  };

  test('page countが2と${page}を含む出力テンプレートから、ページ1とページ2の変換処理単位を生成してsource-1.pngとsource-2.pngへ割り当てる', () => {
    const jobs = planPdfPageJobs(source, 2, '${fileDirname}/${fileBasenameNoExtension}-${page}.png', ['.png']);

    assert.deepStrictEqual(
      jobs.map(({ page, outputPath }) => ({ page, outputPath })),
      [
        { page: 1, outputPath: path.join(workspacePath, 'source-1.png') },
        { page: 2, outputPath: path.join(workspacePath, 'source-2.png') },
      ],
    );
  });

  test('複数ページを分割する出力テンプレートに${page}が含まれない場合は変換処理単位を展開せず、${page}必須のエラーで拒否する', () => {
    assert.throws(
      () => planPdfPageJobs(source, 2, '${fileDirname}/${fileBasenameNoExtension}.png', ['.png']),
      /Split output for multiple pages or frames requires \$\{page\} in the output path\./,
    );
  });

  test('page countが0のPDFは変換処理単位を1件も作らず、PDFにページが無いことを示すエラーで拒否する', () => {
    assert.throws(
      () => planPdfPageJobs(source, 0, '${fileDirname}/${fileBasenameNoExtension}-${page}.png', ['.png']),
      new RegExp(`PDF has no pages: ${RegExp.escape(source.sourcePath)}`),
    );
  });
});
