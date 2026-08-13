import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mergePdf } from '@graphics-workbench/core/pdf';
import { PDFDocument, operationPdfInputDirectory } from '@graphics-workbench/core/testing';

const firstFixturePath = path.join(operationPdfInputDirectory, 'multi-page-table.pdf');
const secondFixturePath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');

suite('複数PDFのheadless結合', () => {
  test('複数PDFを入力順に結合し、各入力ページを保持した1つのPDFを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-operation-'));
    const firstPath = path.join(workspacePath.path, 'first.pdf');
    const secondPath = path.join(workspacePath.path, 'second.pdf');
    const outputPath = path.join(workspacePath.path, 'merged.pdf');
    await copyFile(firstFixturePath, firstPath);
    await copyFile(secondFixturePath, secondPath);

    const outputs = await mergePdf({
      sourcePaths: [firstPath, secondPath],
      outputPath,
      workspacePath: workspacePath.path,
      runtime: {},
      runId: 'merge-correctness',
    });

    assert.strictEqual(outputs.length, 1);
    const outputDocument = await PDFDocument.load(await readFile(outputPath));
    const firstDocument = await PDFDocument.load(await readFile(firstPath));
    const secondDocument = await PDFDocument.load(await readFile(secondPath));
    assert.strictEqual(outputDocument.getPageCount(), firstDocument.getPageCount() + secondDocument.getPageCount());
  });

  test('入力PDFが2つ未満の場合は結合を開始せず拒否する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-validation-'));
    const inputPath = path.join(workspacePath.path, 'input.pdf');
    await copyFile(firstFixturePath, inputPath);

    await assert.rejects(
      mergePdf({
        sourcePaths: [inputPath],
        outputPath: path.join(workspacePath.path, 'merged.pdf'),
        workspacePath: workspacePath.path,
        runtime: {},
      }),
      /at least two PDF files/u,
    );
  });
});
