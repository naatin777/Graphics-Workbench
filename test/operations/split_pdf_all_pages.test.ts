// Test target:
// - 1件以上のPDFを1ページごとに分割し、全成功後に出力すること
// - 既存出力、出力重複、キャンセル時に出力を反映しないこと
// - 固定fixtureの各分割ページが元PDFの対応ページと同じ描画内容であること
//
// Mocked:
// - なし。mupdfと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - commandからのURI選択

import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../helpers/pdf_document.js';

import { splitPdfAllPages } from '../../vscode/src/operations/pdf/split_pdf.js';

import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';
import { assertRenderedPdfPagesSimilar } from '../helpers/pdf_visual_assertions.js';

suite('PDF全ページ分割', () => {
  test('multi-page-table.pdfの全ページを1から始まるページ番号で1ページずつのPDFへ分割し、各分割ページが元の対応ページと同じ描画内容であることを確認する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-test-'));
    const sourcePath = path.join(workspacePath.path, 'multi-page-table.pdf');
    const outputDirectory = path.join(workspacePath.path, 'source');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);

    await splitPdfAllPages({
      inputs: [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          outputPathForPage: (page: number) => path.join(outputDirectory, `${page}.pdf`),
        },
      ],
      runId: 'run',
    });

    const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
    for (let page = 1; page <= sourceDocument.getPageCount(); page += 1) {
      const outputPath = path.join(outputDirectory, `${page}.pdf`);
      const output = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(output.getPageCount(), 1);
      await assertRenderedPdfPagesSimilar({
        expectedPdfPath: sourcePath,
        expectedPageNumber: page,
        actualPdfPath: outputPath,
        actualPageNumber: 1,
        renderDirectory: path.join(workspacePath.path, 'rendered'),
        renderPrefix: `split-single-${page}`,
      });
    }

    const stagingDirectory = path.join(
      workspacePath.path,
      '.graphics-workbench',
      'split-pdf',
      'run',
      '1-multi-page-table',
    );
    await assert.doesNotReject(access(path.join(stagingDirectory, 'multi-page-table.pdf')));
    await assert.doesNotReject(access(path.join(stagingDirectory, 'pages', '1.pdf')));
    await assert.doesNotReject(access(path.join(stagingDirectory, 'pages', '2.pdf')));
  });

  test('複数のPDFをまとめて分割し、すべての入力の分割が成功した後に各ページを出力して元の対応ページと描画内容を比較する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-test-'));
    const sourcePaths = ['multi-page-table.pdf', 'multilingual-text.pdf'].map((fileName) =>
      path.join(workspacePath.path, fileName),
    );

    await Promise.all(sourcePaths.map((sourcePath) => copyFile(fixturePath(path.basename(sourcePath)), sourcePath)));

    await splitPdfAllPages({
      inputs: sourcePaths.map((sourcePath) => ({
        sourcePath,
        workspacePath: workspacePath.path,
        outputPathForPage: (page: number) =>
          path.join(workspacePath.path, path.basename(sourcePath, '.pdf'), `${page}.pdf`),
      })),
    });

    for (const [sourceIndex, sourcePath] of sourcePaths.entries()) {
      const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
      for (let page = 1; page <= sourceDocument.getPageCount(); page += 1) {
        const outputPath = path.join(workspacePath.path, path.basename(sourcePath, '.pdf'), `${page}.pdf`);
        await assert.doesNotReject(access(outputPath));
        await assertRenderedPdfPagesSimilar({
          expectedPdfPath: sourcePath,
          expectedPageNumber: page,
          actualPdfPath: outputPath,
          actualPageNumber: 1,
          renderDirectory: path.join(workspacePath.path, 'rendered'),
          renderPrefix: `split-multiple-${sourceIndex + 1}-${page}`,
        });
      }
    }
  });

  test('分割先のページ出力ファイルが既に存在する場合は分割を開始せず、他ページの出力も作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-split-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const firstOutputPath = path.join(workspacePath, 'source', '1.pdf');
    const secondOutputPath = path.join(workspacePath, 'source', '2.pdf');
    await writePdf(sourcePath, 2);
    await mkdir(path.dirname(secondOutputPath), { recursive: true });
    await writeFile(secondOutputPath, 'existing');

    await assert.rejects(
      splitPdfAllPages({
        inputs: [
          {
            sourcePath,
            workspacePath,
            outputPathForPage: (page: number) => (page === 1 ? firstOutputPath : secondOutputPath),
          },
        ],
      }),
      /Output file already exists/,
    );

    await assert.rejects(access(firstOutputPath));
    assert.strictEqual(await readFile(secondOutputPath, 'utf8'), 'existing');
  });

  test('複数ページが同じ出力パスを指す場合はsame outputエラーで失敗し、出力ファイルを作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-split-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'same.pdf');
    await writePdf(sourcePath, 2);

    await assert.rejects(
      splitPdfAllPages({
        inputs: [
          {
            sourcePath,
            workspacePath,
            outputPathForPage: () => outputPath,
          },
        ],
      }),
      /same output/,
    );

    await assert.rejects(access(outputPath));
  });

  test('事前にabortしたAbortSignalを渡すと、処理を開始せずAbortErrorで拒否され、出力ファイルは作成されない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-split-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'source', '1.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath, 1);
    abortController.abort();

    await assert.rejects(
      splitPdfAllPages({
        inputs: [
          {
            sourcePath,
            workspacePath,
            outputPathForPage: () => outputPath,
          },
        ],
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });
});

async function writePdf(filePath: string, pageCount: number): Promise<void> {
  const document = await PDFDocument.create();

  for (let page = 1; page <= pageCount; page++) {
    document.addPage([100 + page, 200 + page]);
  }

  await writeFile(filePath, await document.save());
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
