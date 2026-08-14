import assert from 'node:assert/strict';
import path from 'node:path';

import { planPdfPageJobs } from '@graphics-workbench/core/conversion';

const workspacePath = process.platform === 'win32' ? 'C:\\test-workspace' : '/test-workspace';

describe('ページ数と出力テンプレートからPDFページごとの出力パスを生成する処理', () => {
  const source = {
    sourcePath: path.join(workspacePath, 'source.pdf'),
    workspacePath,
    workspaceName: 'test-workspace',
  };

  it('page countが2と${page}を含む出力テンプレートから、ページ1とページ2の変換処理単位を生成してsource-1.pngとsource-2.pngへ割り当てる', () => {
    const jobs = planPdfPageJobs(source, 2, '${fileDirname}/${fileBasenameNoExtension}-${page}.png', ['.png']);

    assert.deepStrictEqual(
      jobs.map(({ page, outputPath }) => ({ page, outputPath })),
      [
        { page: 1, outputPath: path.join(workspacePath, 'source-1.png') },
        { page: 2, outputPath: path.join(workspacePath, 'source-2.png') },
      ],
    );
  });

  it('複数ページを分割する出力テンプレートに${page}が含まれない場合は変換処理単位を展開せず、${page}必須のエラーで拒否する', () => {
    assert.throws(
      () => planPdfPageJobs(source, 2, '${fileDirname}/${fileBasenameNoExtension}.png', ['.png']),
      /Split output for multiple pages or frames requires \$\{page\} in the output path\./,
    );
  });

  it('page countが0のPDFは変換処理単位を1件も作らず、PDFにページが無いことを示すエラーで拒否する', () => {
    assert.throws(
      () => planPdfPageJobs(source, 0, '${fileDirname}/${fileBasenameNoExtension}-${page}.png', ['.png']),
      new RegExp(`PDF has no pages: ${RegExp.escape(source.sourcePath)}`),
    );
  });

  it('選択pageは最初に現れた順で重複を除き、page countの桁数で03, 01の出力パスを作る', () => {
    const jobs = planPdfPageJobs(
      source,
      12,
      '${fileDirname}/${fileBasenameNoExtension}-${page}.png',
      ['.png'],
      [3, 1, 3],
    );

    assert.deepStrictEqual(
      jobs.map(({ page, outputPath }) => ({ page, outputPath })),
      [
        { page: 3, outputPath: path.join(workspacePath, 'source-03.png') },
        { page: 1, outputPath: path.join(workspacePath, 'source-01.png') },
      ],
    );
  });

  it('選択pageが空、0、負数、小数、page count超過の場合は出力パスを作らず拒否する', () => {
    const template = '${fileDirname}/${fileBasenameNoExtension}-${page}.png';
    assert.throws(() => planPdfPageJobs(source, 12, template, ['.png'], []), /At least one PDF page/u);
    for (const page of [0, -1, 1.5, 13]) {
      assert.throws(() => planPdfPageJobs(source, 12, template, ['.png'], [page]), /outside the range 1-12/u);
    }
  });

  it('page countが負数、小数、NaNの場合はPDFにpageが無いエラーで拒否する', () => {
    const template = '${fileDirname}/${fileBasenameNoExtension}-${page}.png';
    for (const pageCount of [-1, 1.5, Number.NaN]) {
      assert.throws(
        () => planPdfPageJobs(source, pageCount, template, ['.png']),
        new RegExp(`PDF has no pages: ${RegExp.escape(source.sourcePath)}`),
      );
    }
  });
});
