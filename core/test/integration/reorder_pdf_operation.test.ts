// Test target:
// - 指定順序でページを並び替えて出力すること
// - 出力PDFのページ順が正しいこと
// - 既存出力、キャンセル時に出力を反映しないこと
// - ページ順が順列でない場合は失敗すること
//
// Mocked:
// - なし。mupdfと実ファイルを使用する
//
import assert from 'node:assert/strict';
import { access, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { reorderPdfFiles } from '@graphics-workbench/core/pdf';
import { createPdfTestData, readPdfPages } from '@graphics-workbench/core/testing';

describe('PDFページ並び替え', () => {
  it('3ページのPDFへページ順[3,1,2]を指定すると、出力PDFは3ページを保ちながら元の3・1・2ページ目の順に並ぶ', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    const outputs = await reorderPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [3, 1, 2] }],
      runtime: {},
      runId: 'run',
    });
    assert.strictEqual(outputs.length, 1);

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(outputPages.length, 3);
    assert.deepStrictEqual(readPageWidths(outputPages), [102, 100, 101]);
  });

  it('3ページのPDFにページ順[1,2]や[1,1,2]のように全ページをちょうど1回ずつ含まない順列以外を指定すると、ページ数不一致や重複として失敗する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    await assert.rejects(
      reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [1, 2] }],
        runtime: {},
      }),
      /exactly 3 pages/,
    );

    await assert.rejects(
      reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [1, 1, 2] }],
        runtime: {},
      }),
      /more than once/,
    );
  });

  it('出力先ファイルが既に存在する場合は並び替えを開始せず、既存の出力ファイルも変更しない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 2);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [2, 1] }],
        runtime: {},
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  it('事前にabortしたAbortSignalを渡すと、処理を開始せずAbortErrorで拒否され、出力ファイルは作成されない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath, 2);
    abortController.abort();

    await assert.rejects(
      reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [2, 1] }],
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });
});

async function writePdf(filePath: string, pageCount: number): Promise<void> {
  const bytes = await createPdfTestData({
    pages: Array.from({ length: pageCount }, (_, index) => ({ mediaBox: [0, 0, 100 + index, 200] })),
  });
  await writeFile(filePath, bytes);
}

function readPageWidths(pages: { mediaBox: { width: number } }[]): number[] {
  return pages.map((page) => page.mediaBox.width);
}
