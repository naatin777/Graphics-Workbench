import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mergePdf } from '@graphics-workbench/core/pdf';
import { operationPdfInputDirectory, readPdfPages } from '@graphics-workbench/core/testing';

const firstTestDataPath = path.join(operationPdfInputDirectory, 'multi-page-table.pdf');
const secondTestDataPath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');

describe('複数PDFのheadless結合', () => {
  it('複数PDFを入力順に結合し、各入力ページを保持した1つのPDFを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-operation-'));
    const firstPath = path.join(workspacePath.path, 'first.pdf');
    const secondPath = path.join(workspacePath.path, 'second.pdf');
    const outputPath = path.join(workspacePath.path, 'merged.pdf');
    await copyFile(firstTestDataPath, firstPath);
    await copyFile(secondTestDataPath, secondPath);

    const outputs = await mergePdf({
      sourcePaths: [firstPath, secondPath],
      outputPath,
      workspacePath: workspacePath.path,
      runtime: {},
      runId: 'merge-correctness',
    });

    assert.strictEqual(outputs.length, 1);
    const outputPages = await readPdfPages(await readFile(outputPath));
    const firstPages = await readPdfPages(await readFile(firstPath));
    const secondPages = await readPdfPages(await readFile(secondPath));
    assert.strictEqual(outputPages.length, firstPages.length + secondPages.length);
  });

  it('入力PDFが2つ未満の場合は結合を開始せず拒否する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-validation-'));
    const inputPath = path.join(workspacePath.path, 'input.pdf');
    await copyFile(firstTestDataPath, inputPath);

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
