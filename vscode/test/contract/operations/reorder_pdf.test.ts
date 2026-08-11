// Test target:
// - 指定順序でページを並び替えて出力すること
// - 出力PDFのページ順が正しいこと
// - 既存出力、キャンセル時に出力を反映しないこと
// - ページ順が順列でない場合は失敗すること
//
// Mocked:
// - なし。mupdfと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - Configure Webviewのページ移動操作

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../../support/helpers/pdf_document.js';

import {
  isReorderPdfHostToWebviewMessage,
  isReorderPdfWebviewToHostMessage,
} from '../../../src/shared/protocols/reorder_pdf_protocol.js';
import { reorderPdfFiles } from '../../../src/operations/pdf/reorder_pdf.js';

suite('PDFページ並び替え', () => {
  test('3ページのPDFへページ順[3,1,2]を指定すると、出力PDFは3ページを保ちながら元の3・1・2ページ目の順に並ぶ', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    try {
      const outputs = await reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [3, 1, 2] }],
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

  test('3ページのPDFにページ順[1,2]や[1,1,2]のように全ページをちょうど1回ずつ含まない順列以外を指定すると、ページ数不一致や重複として失敗する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    await assert.rejects(
      reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [1, 2] }],
      }),
      /exactly 3 pages/,
    );

    await assert.rejects(
      reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [1, 1, 2] }],
      }),
      /more than once/,
    );
  });

  test('出力先ファイルが既に存在する場合は並び替えを開始せず、既存の出力ファイルも変更しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 2);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      reorderPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, pageOrder: [2, 1] }],
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('事前にabortしたAbortSignalを渡すと、処理を開始せずAbortErrorで拒否され、出力ファイルは作成されない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-reorder-test-'));
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

suite('Reorder PDFのWebview⇔ホスト間メッセージ型検証', () => {
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
    resources: {
      workerSrc: 'vscode-resource://pdf.worker.mjs',
      cMapUrl: 'vscode-resource://cmaps/',
      standardFontDataUrl: 'vscode-resource://standard_fonts/',
      wasmUrl: 'vscode-resource://wasm/',
    },
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  };

  test('必須フィールドをすべて持つ正しいinitメッセージは受け入れられる', () => {
    assert.strictEqual(isReorderPdfHostToWebviewMessage({ type: 'init', payload: initPayload }), true);
  });

  test('applyメッセージのページ順が空の場合は拒否される', () => {
    assert.strictEqual(isReorderPdfWebviewToHostMessage({ type: 'apply', payload: { order: [] } }), false);
  });

  test('applyメッセージのページ順[3,1,2]が定義された配列を持つ場合は受け入れられる', () => {
    assert.strictEqual(isReorderPdfWebviewToHostMessage({ type: 'apply', payload: { order: [3, 1, 2] } }), true);
  });

  test('initメッセージに定義外のsourcePathキーが含まれる場合は拒否される', () => {
    assert.strictEqual(
      isReorderPdfHostToWebviewMessage({ type: 'init', payload: { ...initPayload, sourcePath: '/not-allowed' } }),
      false,
    );
  });

  test('メッセージ共通枠で許されないrequestIdキーを最上位に付けると拒否される', () => {
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
