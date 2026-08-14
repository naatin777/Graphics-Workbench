// Test target:
// - 指定角度でPDFの全ページまたは選択ページを回転し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFの各ページに回転角度が設定されていること
//
// Mocked:
// - なし。mupdfと実ファイルを使用する
//
import assert from 'node:assert/strict';
import { access, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { rotatePdfFiles } from '@graphics-workbench/core/pdf';
import { readPdfPages, createPdfTestData } from '@graphics-workbench/core/testing';

describe('PDFページ回転', () => {
  it('3ページのPDFへ角度90を指定すると、出力PDFは3ページを保ったまま全ページの回転角を90度として保存する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    const outputs = await rotatePdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
      runtime: {},
      runId: 'run',
    });
    assert.strictEqual(outputs.length, 1);
    assert.strictEqual(outputs[0]?.outputPath, outputPath);

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(outputPages.length, 3);
    for (const page of outputPages) {
      assert.strictEqual(page.rotation, 90);
    }
  });

  it('既に90度回転している1ページのPDFにさらに90度回転を適用すると、既存の回転角に加算して180度として保存する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-pre-rotated-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 1, 90);

    await rotatePdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
      runtime: {},
      runId: 'run',
    });

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(outputPages.length, 1);
    assert.strictEqual(outputPages[0]?.rotation, 180);
  });

  it('3ページのPDFで2番目のページだけに角度180を指定すると、2番目のページだけ回転角180度になり他のページは0度のままになる', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    await rotatePdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath, angle: 180, pageIndices: [1] }],
      runtime: {},
      runId: 'run',
    });

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(outputPages[0]?.rotation, 0);
    assert.strictEqual(outputPages[1]?.rotation, 180);
    assert.strictEqual(outputPages[2]?.rotation, 0);
  });

  it('出力先ファイルが既に存在する場合は回転を開始せず、既存の出力ファイルも変更しない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 1);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: {},
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  it('事前にabortしたAbortSignalを渡すと、処理を開始せずAbortErrorで拒否され、出力ファイルは作成されない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath, 1);
    abortController.abort();

    await assert.rejects(
      rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });

  it('2ページのPDFに対して範囲外のページ番号5を指定すると、out of rangeエラーで失敗する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 2);

    await assert.rejects(
      rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90, pageIndices: [5] }],
        runtime: {},
      }),
      /out of range/,
    );
  });
});

async function writePdf(filePath: string, pageCount: number, rotation = 0): Promise<void> {
  const bytes = await createPdfTestData({
    pages: Array.from({ length: pageCount }, (_, index) => ({
      mediaBox: [0, 0, 100 + index, 200],
      ...(rotation === 0 ? {} : { rotation }),
    })),
  });
  await writeFile(filePath, bytes);
}
