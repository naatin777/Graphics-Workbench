// Test target:
// - 指定順序でページを並び替えて出力すること
// - 出力PDFのページ順が正しいこと
// - 既存出力、キャンセル時に出力を反映しないこと
// - ページ順が順列でない場合は失敗すること
//
// Mocked:
// - なし。実pdf-libと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - Configure Webviewのページ移動操作

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import {
  isReorderPdfHostToWebviewMessage,
  isReorderPdfWebviewToHostMessage,
} from '../../src/application/protocols/reorder_pdf_protocol.js';
import { reorderPdfFiles } from '../../src/operations/pdf/reorder_pdf.js';

suite('PDF並び替え', () => {
  test('指定順序でページを並び替えて出力する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    try {
      const outputs = await reorderPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, pageOrder: [3, 1, 2] }],
        runId: 'run',
      });
      assert.strictEqual(outputs.length, 1);

      const output = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(output.getPageCount(), 3);
      assert.deepStrictEqual(readPageWidths(output), [102, 100, 101]);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('ページ順が順列でない場合は失敗する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    await assert.rejects(
      reorderPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, pageOrder: [1, 2] }],
      }),
      /exactly 3 pages/,
    );

    await assert.rejects(
      reorderPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, pageOrder: [1, 1, 2] }],
      }),
      /more than once/,
    );
  });

  test('出力先が既に存在する場合は何も作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 2);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      reorderPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, pageOrder: [2, 1] }],
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('キャンセルされた場合は出力しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath, 2);
    abortController.abort();

    await assert.rejects(
      reorderPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, pageOrder: [2, 1] }],
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });
});

suite('reorderPdf protocol guard', () => {
  const labels = {
    header: { title: 'Reorder PDF', description: 'description' },
    preview: {
      title: 'Preview',
      ariaLabel: 'preview',
      renderError: 'error',
      applyError: 'error',
    },
    order: { title: 'Order', moveUp: 'up', moveDown: 'down', positionLabel: 'pages' },
    validation: { orderRequired: 'required', orderInvalid: 'invalid' },
    actions: { apply: 'Apply', cancel: 'Cancel' },
  };

  const initPayload = {
    sourceId: 'source-1',
    fileName: 'source.pdf',
    pageCount: 3,
    pdfSrc: 'vscode-resource://source.pdf',
    resources: {},
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  };

  test('正しいinitメッセージを受け入れる', () => {
    assert.strictEqual(isReorderPdfHostToWebviewMessage({ type: 'init', payload: initPayload }), true);
  });

  test('空のページ順を拒否する', () => {
    assert.strictEqual(isReorderPdfWebviewToHostMessage({ type: 'apply', payload: { order: [] } }), false);
  });

  test('正しいapplyメッセージを受け入れる', () => {
    assert.strictEqual(isReorderPdfWebviewToHostMessage({ type: 'apply', payload: { order: [3, 1, 2] } }), true);
  });

  test('追加キーを持つinitを拒否する', () => {
    assert.strictEqual(
      isReorderPdfHostToWebviewMessage({ type: 'init', payload: { ...initPayload, sourcePath: '/not-allowed' } }),
      false,
    );
  });

  test('共有envelopeのtop-level追加キーを拒否する', () => {
    assert.strictEqual(
      isReorderPdfWebviewToHostMessage({
        type: 'apply',
        payload: { order: [2, 1] },
        requestId: 'request-1',
      }),
      false,
    );
  });
});

async function writePdf(filePath: string, pageCount: number): Promise<void> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) {
    document.addPage([100 + index, 200]);
  }
  await writeFile(filePath, await document.save());
}

function readPageWidths(document: PDFDocument): number[] {
  return document.getPages().map((page) => page.getSize().width);
}
