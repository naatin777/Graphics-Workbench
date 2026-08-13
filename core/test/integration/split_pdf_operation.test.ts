// Test target:
// - 1件以上のPDFを1ページごとまたはページグループごとに分割し、全成功後に出力すること
// - ページ式の解析が入力順の展開・重複保持・不正式の拒否を正しく行うこと
// - 既存出力、出力重複、キャンセル時に出力を反映しないこと
// - 固定fixtureの各分割ページが元PDFの対応ページと同じ描画内容であること
//
// Mocked:
// - なし。mupdfと実ファイルを使用する
//
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../../../test-support/pdf_document.js';

import { parsePdfPageSelection as parseSplitPdfPages } from '@graphics-workbench/core/formats';
import { splitPdfAllPages, splitPdfByPageGroups } from '@graphics-workbench/core/pdf';
import { invalidPreflightInputDirectory, operationPdfInputDirectory } from '../helpers/fixture_paths.js';
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
      runtime: {},
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
      runtime: {},
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
        runtime: {},
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
        runtime: {},
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

suite('PDFページグループ分割', () => {
  test('ページ式"10, 3-5, 3, -2, 7-"を10ページのPDFで解析すると、入力順のまま範囲を展開し重複を保持したページ列を返す', () => {
    assert.deepEqual(parseSplitPdfPages('10, 3-5, 3, -2, 7-', 10), {
      ok: true,
      pages: [10, 3, 4, 5, 3, 1, 2, 7, 8, 9, 10],
    });
  });

  test('空の式やカンマ連続（1,,3）、降順範囲（3-1）、ページ数超過（4）のページ式は解析失敗にする', () => {
    assert.equal(parseSplitPdfPages('1,,3', 3).ok, false);
    assert.equal(parseSplitPdfPages('-', 3).ok, false);
    assert.equal(parseSplitPdfPages('3-1', 3).ok, false);
    assert.equal(parseSplitPdfPages('4', 3).ok, false);
  });

  test('ページグループ[[3,1,3],[2]]を指定すると、group1は3→1→3の順で重複を保持し、group2は2ページ目だけのPDFとして生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-groups-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');

    await writePdfWithWidths(sourcePath, [101, 102, 103]);

    await splitPdfByPageGroups({
      inputs: [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          pageGroups: [[3, 1, 3], [2]],
          outputPathForGroup: (groupIndex) => path.join(workspacePath.path, `group-${groupIndex + 1}.pdf`),
        },
      ],
      runtime: {},
      runId: 'run',
    });

    const firstGroup = await PDFDocument.load(await readFile(path.join(workspacePath.path, 'group-1.pdf')));
    const secondGroup = await PDFDocument.load(await readFile(path.join(workspacePath.path, 'group-2.pdf')));

    assert.deepEqual(
      firstGroup.getPages().map((page) => page.getWidth()),
      [103, 101, 103],
    );
    assert.deepEqual(
      secondGroup.getPages().map((page) => page.getWidth()),
      [102],
    );
    await access(
      path.join(workspacePath.path, '.graphics-workbench', 'split-pdf', 'run', '1-source', 'groups', '1.pdf'),
    );
  });

  test('分割処理の事前検証で拒否され、一時領域も分割出力も作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-groups-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'group.pdf');
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'split-pdf', 'run');
    const invalidPdfPath = path.join(invalidPreflightInputDirectory, 'not-a-pdf.pdf');

    await copyFile(invalidPdfPath, sourcePath);

    await assert.rejects(
      splitPdfByPageGroups({
        inputs: [
          {
            sourcePath,
            workspacePath: workspacePath.path,
            pageGroups: [[1]],
            outputPathForGroup: () => outputPath,
          },
        ],
        runtime: {},
        runId: 'run',
      }),
      /Preflight validation failed|Failed to parse PDF|No PDF header found/,
    );

    await assert.rejects(access(outputPath));
    await assert.rejects(access(stagingRootPath));
  });

  test('ページ数の範囲外グループ（[1,3]）と空グループ（[]）は出力前に拒否して出力PDFを作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-groups-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'group.pdf');

    await writePdfWithWidths(sourcePath, [101, 102]);

    await assert.rejects(
      splitPdfByPageGroups({
        inputs: [
          {
            sourcePath,
            workspacePath: workspacePath.path,
            pageGroups: [[1, 3]],
            outputPathForGroup: () => outputPath,
          },
        ],
        runtime: {},
      }),
      /out of range/,
    );
    await assert.rejects(access(outputPath));

    await assert.rejects(
      splitPdfByPageGroups({
        inputs: [
          {
            sourcePath,
            workspacePath: workspacePath.path,
            pageGroups: [[]],
            outputPathForGroup: () => outputPath,
          },
        ],
        runtime: {},
      }),
      /cannot be empty/,
    );
  });
});

async function writePdf(filePath: string, pageCount: number): Promise<void> {
  const document = await PDFDocument.create();

  for (let page = 1; page <= pageCount; page++) {
    document.addPage([100 + page, 200 + page]);
  }

  await writeFile(filePath, await document.save());
}

async function writePdfWithWidths(filePath: string, widths: readonly number[]): Promise<void> {
  const document = await PDFDocument.create();

  for (const width of widths) {
    document.addPage([width, 200]);
  }

  await writeFile(filePath, await document.save());
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
