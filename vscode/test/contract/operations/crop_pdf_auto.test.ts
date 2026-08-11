// Test target:
// - cropPdfFilesのPDF変換結果、workspace境界検証、キャンセル時の停止動作
//
// Mocked:
// - なし（内容バウンディングボックスはmupdfの描画スキャンで検出する）
//
// Not tested:
// - VS Codeのcommand UI
// - withProgressの表示

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument, degrees, rgb } from '../../support/helpers/pdf_document.js';

import { cropPdfFiles } from '../../../src/operations/pdf/crop_pdf_auto.js';

suite('PDF自動crop処理', () => {
  test('2ページPDFの各ページを描画スキャンで検出した内容バウンディングボックス＋マージン5の範囲でcropし、MediaBox・CropBoxを更新して一時作業ディレクトリへinput.pdf・result.pdfを作成する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output', 'source-crop.pdf');
    await writeFixturePdf(sourcePath);

    await cropPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath }],
      margin: 5,
      runId: 'run',
    });

    const outputDocument = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(outputDocument.getPageCount(), 2);
    assert.deepStrictEqual(outputDocument.getPage(0).getMediaBox(), {
      x: 5,
      y: 15,
      width: 110,
      height: 110,
    });
    assert.deepStrictEqual(outputDocument.getPage(0).getCropBox(), {
      x: 5,
      y: 15,
      width: 110,
      height: 110,
    });
    assert.deepStrictEqual(outputDocument.getPage(1).getMediaBox(), {
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
    const document = await PDFDocument.create();
    document.addPage([320, 180]);
    await writeFile(sourcePath, await document.save());

    await cropPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath }],
      margin: 20,
    });

    const outputDocument = await PDFDocument.load(await readFile(outputPath));
    assert.deepStrictEqual(outputDocument.getPage(0).getMediaBox(), {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
    assert.deepStrictEqual(outputDocument.getPage(0).getCropBox(), {
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
    const document = await PDFDocument.create();
    const page = document.addPage([400, 300]);
    page.setMediaBox(100, 200, 400, 300);
    page.setRotation(degrees(90));
    page.drawRectangle({ x: 135.25, y: 247.5, width: 80.5, height: 41.25, color: rgb(0, 0, 0) });
    await writeFile(sourcePath, await document.save());

    await cropPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath }],
      margin: 0,
    });

    const outputDocument = await PDFDocument.load(await readFile(outputPath));
    const bounds = outputDocument.getPage(0).getMediaBox();
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
    });

    for (const input of inputs) {
      const outputDocument = await PDFDocument.load(await readFile(input.outputPath));
      assert.strictEqual(outputDocument.getPageCount(), 1);
    }
  });

  test('出力先に既存ファイルがある場合はOutput file already existsエラーでcrop前に失敗し、既存の出力内容を変更しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-crop-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'source-crop.pdf');
    await writeSinglePagePdf(sourcePath);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      cropPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath }],
        margin: 0,
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

    await assert.rejects(cropPdfFiles({ inputs: [{ sourcePath, workspacePath, outputPath }], margin: 0 }));

    await assert.rejects(access(outputPath));
  });
});

async function writeFixturePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  const firstPage = document.addPage([300, 200]);
  firstPage.drawRectangle({ x: 10, y: 20, width: 100, height: 100, color: rgb(1, 0, 0) });
  const secondPage = document.addPage([400, 300]);
  secondPage.drawRectangle({ x: 40, y: 50, width: 200, height: 150, color: rgb(0, 0, 1) });
  await writeFile(filePath, await document.save());
}

async function writeSinglePagePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  const page = document.addPage([100, 100]);
  page.drawRectangle({ x: 10, y: 10, width: 80, height: 80, color: rgb(1, 0, 0) });
  await writeFile(filePath, await document.save());
}
