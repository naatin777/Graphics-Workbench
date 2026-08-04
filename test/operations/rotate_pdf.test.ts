// Test target:
// - 指定角度でPDFの全ページまたは選択ページを回転し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFの各ページに回転角度が設定されていること
//
// Mocked:
// - なし。実pdf-libと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - QuickPickの角度選択

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import {
  isRotatePdfHostToWebviewMessage,
  isRotatePdfWebviewToHostMessage,
} from '../../src/application/protocols/rotate_pdf_protocol.js';
import { rotatePdfFiles } from '../../src/operations/pdf/rotate_pdf.js';

suite('PDF回転', () => {
  test('全ページを90度回転して出力する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    try {
      const outputs = await rotatePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
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

  test('選択ページだけを回転する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 3);

    try {
      await rotatePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, angle: 180, pageIndices: [1] }],
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

  test('出力先が既に存在する場合は何も作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 1);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      rotatePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('キャンセルされた場合は出力しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath, 1);
    abortController.abort();

    await assert.rejects(
      rotatePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, angle: 90 }],
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });

  test('範囲外のページ指定は失敗する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-rotate-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath, 2);

    await assert.rejects(
      rotatePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath, angle: 90, pageIndices: [5] }],
      }),
      /out of range/,
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

suite('rotatePdf protocol guard', () => {
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
    resources: {},
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  };

  test('正しいinitメッセージを受け入れる', () => {
    assert.strictEqual(isRotatePdfHostToWebviewMessage({ type: 'init', payload: initPayload }), true);
  });

  test('不正なapply角度を拒否する', () => {
    assert.strictEqual(
      isRotatePdfWebviewToHostMessage({ type: 'apply', payload: { angle: 45, pageIndices: [1] } }),
      false,
    );
  });

  test('空のページ選択を拒否する', () => {
    assert.strictEqual(
      isRotatePdfWebviewToHostMessage({ type: 'apply', payload: { angle: 90, pageIndices: [] } }),
      false,
    );
  });

  test('正しいapplyメッセージを受け入れる', () => {
    assert.strictEqual(
      isRotatePdfWebviewToHostMessage({ type: 'apply', payload: { angle: 180, pageIndices: [1, 3] } }),
      true,
    );
  });

  test('追加キーを持つinitを拒否する', () => {
    assert.strictEqual(
      isRotatePdfHostToWebviewMessage({ type: 'init', payload: { ...initPayload, sourcePath: '/not-allowed' } }),
      false,
    );
  });
});
