// Test target:
// - 指定角度でPDFの全ページまたは選択ページを回転し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFの各ページに回転角度が設定されていること
//
// Mocked:
// - なし。mupdfと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - QuickPickの角度選択

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { degrees, PDFDocument } from '../helpers/pdf_document.js';

import {
  isRotatePdfHostToWebviewMessage,
  isRotatePdfWebviewToHostMessage,
} from '../../src/shared/protocols/rotate_pdf_protocol.js';
import { rotatePdfFiles } from '../../src/operations/pdf/rotate_pdf.js';

suite('PDFページ回転', () => {
  test('3ページのPDFへ角度90を指定すると、出力PDFは3ページを保ったまま全ページの回転角を90度として保存する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    try {
      const outputs = await rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runId: 'run',
      });
      assert.strictEqual(outputs.length, 1);
      assert.strictEqual(outputs[0]?.outputPath, outputPath);

      const output = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(output.getPageCount(), 3);
      for (const page of output.getPages()) {
        assert.strictEqual(page.getRotation().angle, 90);
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('既に90度回転している1ページのPDFにさらに90度回転を適用すると、既存の回転角に加算して180度として保存する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-rotate-pre-rotated-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 1, 90);

    try {
      await rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runId: 'run',
      });

      const output = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(output.getPageCount(), 1);
      assert.strictEqual(output.getPage(0).getRotation().angle, 180);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('3ページのPDFで2番目のページだけに角度180を指定すると、2番目のページだけ回転角180度になり他のページは0度のままになる', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    try {
      await rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 180, pageIndices: [1] }],
        runId: 'run',
      });

      const output = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(output.getPage(0)?.getRotation().angle, 0);
      assert.strictEqual(output.getPage(1)?.getRotation().angle, 180);
      assert.strictEqual(output.getPage(2)?.getRotation().angle, 0);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('出力先ファイルが既に存在する場合は回転を開始せず、既存の出力ファイルも変更しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 1);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('事前にabortしたAbortSignalを渡すと、処理を開始せずAbortErrorで拒否され、出力ファイルは作成されない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-rotate-test-'));
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

  test('2ページのPDFに対して範囲外のページ番号5を指定すると、out of rangeエラーで失敗する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 2);

    await assert.rejects(
      rotatePdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath, angle: 90, pageIndices: [5] }],
      }),
      /out of range/,
    );
  });
});

async function writePdf(filePath: string, pageCount: number, rotation = 0): Promise<void> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) {
    const page = document.addPage([100 + index, 200]);
    if (rotation !== 0) {
      page.setRotation(degrees(rotation));
    }
  }
  await writeFile(filePath, await document.save());
}

suite('Rotate PDFのWebview⇔ホスト間メッセージ型検証', () => {
  const labels = {
    header: { title: 'Rotate PDF', description: 'description' },
    preview: {
      title: 'Preview',
      description: 'description',
      ariaLabel: 'preview',
      renderError: 'error',
      applyError: 'error',
    },
    rotation: {
      title: 'Rotation',
      angleLabel: 'angle',
      selectAll: 'all',
      selectAllAriaLabel: 'all',
      pageToggle: 'toggle',
    },
    validation: { pagesRequired: 'required', pageOutOfRange: 'range', angleInvalid: 'invalid' },
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
    assert.strictEqual(isRotatePdfHostToWebviewMessage({ type: 'init', payload: initPayload }), true);
  });

  test('applyメッセージの角度が45度のように90度の倍数でない場合は拒否される', () => {
    assert.strictEqual(
      isRotatePdfWebviewToHostMessage({ type: 'apply', payload: { angle: 45, pageIndices: [1] } }),
      false,
    );
  });

  test('applyメッセージのページ選択が空の場合は拒否される', () => {
    assert.strictEqual(
      isRotatePdfWebviewToHostMessage({ type: 'apply', payload: { angle: 90, pageIndices: [] } }),
      false,
    );
  });

  test('applyメッセージの角度180とページ選択[1,3]が定義に合う場合は受け入れられる', () => {
    assert.strictEqual(
      isRotatePdfWebviewToHostMessage({ type: 'apply', payload: { angle: 180, pageIndices: [1, 3] } }),
      true,
    );
  });

  test('initメッセージに定義外のsourcePathキーが含まれる場合は拒否される', () => {
    assert.strictEqual(
      isRotatePdfHostToWebviewMessage({ type: 'init', payload: { ...initPayload, sourcePath: '/not-allowed' } }),
      false,
    );
  });

  test('メッセージ共通枠で許されないrequestIdキーを最上位に付けると拒否される', () => {
    assert.strictEqual(
      isRotatePdfWebviewToHostMessage({
        type: 'apply',
        payload: { angle: 90, pageIndices: [1] },
        requestId: 'request-1',
      }),
      false,
    );
  });
});
