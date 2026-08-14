// Test target:
// - cropPdfFilesのPDF変換結果、workspace境界検証、キャンセル時の停止動作
//
// Mocked:
// - なし（内容バウンディングボックスはmupdfの描画スキャンで検出する）
//
// Not tested:
// - VS Codeのcommand UI
// - withProgressの表示

import { createPdfTestData, fillRectangle, readPdfPages } from '@graphics-workbench/core/testing';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { cropPdfFiles } from '../../../src/adapters/crop/crop_pdf_auto.js';

suite('PDF自動crop処理', () => {
  test('2ページPDFの各ページを描画スキャンで検出した内容バウンディングボックス＋マージン5の範囲でcropし、MediaBox・CropBoxを更新して一時作業ディレクトリへinput.pdf・result.pdfを作成する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output', 'source-crop.pdf');
    await writeTestDataPdf(sourcePath);

    await cropPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath }],
      margin: 5,
      runtime: {},
      runId: 'run',
    });

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(outputPages.length, 2);
    assert.deepStrictEqual(outputPages[0]?.mediaBox, {
      x: 5,
      y: 15,
      width: 110,
      height: 110,
    });
    assert.deepStrictEqual(outputPages[0]?.cropBox, {
      x: 5,
      y: 15,
      width: 110,
      height: 110,
    });
    assert.deepStrictEqual(outputPages[1]?.mediaBox, {
      x: 35,
      y: 45,
      width: 210,
      height: 160,
    });

    const workDirectory = path.join(workspacePath, '.graphics-workbench', 'crop-pdf', 'run', '1-source');
    await access(path.join(workDirectory, 'source.pdf'));
    await access(path.join(workDirectory, 'result.pdf'));
  });

  test('内容が無い320x180のPDFページではcrop範囲を検出できず、元のMediaBox・CropBoxを維持して出力する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const sourcePath = path.join(workspacePath, 'blank.pdf');
    const outputPath = path.join(workspacePath, 'blank-crop.pdf');
    await writeFile(sourcePath, await createPdfTestData({ pages: [{ mediaBox: [0, 0, 320, 180] }] }));

    await cropPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath }],
      margin: 20,
      runtime: {},
    });

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.deepStrictEqual(outputPages[0]?.mediaBox, {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
    assert.deepStrictEqual(outputPages[0]?.cropBox, {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
  });

  test('offset MediaBoxと90度回転のページでも、検出したcontentの座標系で最終boundsを数値固定する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-geometry-test-'));
    const sourcePath = path.join(workspacePath, 'geometry.pdf');
    const outputPath = path.join(workspacePath, 'geometry-crop.pdf');
    await writeFile(
      sourcePath,
      await createPdfTestData({
        pages: [
          {
            mediaBox: [100, 200, 500, 500],
            rotation: 90,
            contents: [fillRectangle({ x: 135.25, y: 247.5, width: 80.5, height: 41.25 })],
          },
        ],
      }),
    );

    await cropPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath }],
      margin: 0,
      runtime: {},
    });

    const outputPages = await readPdfPages(await readFile(outputPath));
    const bounds = outputPages[0]?.mediaBox;
    assert.ok(bounds !== undefined);
    assert.ok(Math.abs(bounds.x - 135.25) <= 1);
    assert.ok(Math.abs(bounds.y - 247.5) <= 1);
    assert.ok(Math.abs(bounds.width - 80.5) <= 1);
    assert.ok(Math.abs(bounds.height - 41.25) <= 1);
  });

  test('4つのPDFを1回のcropPdfFiles呼び出しで並列にcrop変換し、各jobの出力PDFを作成する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const inputs = await Promise.all(
      ['first', 'second', 'third', 'fourth'].map(async (name) => {
        const sourcePath = path.join(workspacePath, `${name}.pdf`);
        await writeSinglePagePdf(sourcePath);

        return {
          sourcePath,
          workspacePath,
          outputPath: path.join(workspacePath, 'output', `${name}.pdf`),
        };
      }),
    );

    await cropPdfFiles({
      inputs,
      margin: 0,
      runtime: {},
    });

    for (const input of inputs) {
      const outputPages = await readPdfPages(await readFile(input.outputPath));
      assert.strictEqual(outputPages.length, 1);
    }
  });

  test('出力先に既存ファイルがある場合はcommit時にOutput file already existsエラーとなり、既存の出力内容を変更しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'source-crop.pdf');
    await writeSinglePagePdf(sourcePath);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      cropPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath }],
        margin: 0,
        runtime: {},
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('宣言されたworkspace外のディレクトリにある入力ファイルを渡すと、変換を開始せずoutside the workspaceエラーで失敗する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'gw-outside-'));
    const sourcePath = path.join(outsideDirectory, 'source.pdf');
    const outputPath = path.join(workspacePath, 'source-crop.pdf');
    await writeSinglePagePdf(sourcePath);

    await assert.rejects(
      cropPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath }],
        margin: 0,
        runtime: {},
      }),
      /outside the workspace/,
    );
  });

  test('出力パスが宣言されたworkspace外を指している場合は、変換を開始せずoutside the workspaceエラーで失敗する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'gw-outside-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(outsideDirectory, 'source-crop.pdf');
    await writeSinglePagePdf(sourcePath);

    await assert.rejects(
      cropPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath }],
        margin: 0,
        runtime: {},
      }),
      /outside the workspace/,
    );
  });

  test('abort済みのsignalを渡すと変換を開始せずAbortErrorで失敗し、出力を作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'source-crop.pdf');
    const abortController = new AbortController();
    await writeSinglePagePdf(sourcePath);
    abortController.abort();

    await assert.rejects(
      cropPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath }],
        margin: 0,
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });

  test('解釈できないPDF（%PDF-1.7で始まる不正な内容）を入力するとcrop変換が失敗し、出力を作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const sourcePath = path.join(workspacePath, 'broken.pdf');
    const outputPath = path.join(workspacePath, 'broken-crop.pdf');
    await writeFile(sourcePath, '%PDF-1.7\nnot a real pdf');

    await assert.rejects(cropPdfFiles({ inputs: [{ sourcePath, workspacePath, outputPath }], margin: 0, runtime: {} }));

    await assert.rejects(access(outputPath));
  });
});

async function writeTestDataPdf(filePath: string): Promise<void> {
  const bytes = await createPdfTestData({
    pages: [
      {
        mediaBox: [0, 0, 300, 200],
        contents: [fillRectangle({ x: 10, y: 20, width: 100, height: 100, color: [1, 0, 0] })],
      },
      {
        mediaBox: [0, 0, 400, 300],
        contents: [fillRectangle({ x: 40, y: 50, width: 200, height: 150, color: [0, 0, 1] })],
      },
    ],
  });
  await writeFile(filePath, bytes);
}

async function writeSinglePagePdf(filePath: string): Promise<void> {
  const bytes = await createPdfTestData({
    pages: [
      {
        mediaBox: [0, 0, 100, 100],
        contents: [fillRectangle({ x: 10, y: 10, width: 80, height: 80, color: [1, 0, 0] })],
      },
    ],
  });
  await writeFile(filePath, bytes);
}
