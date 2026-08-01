// Test target:
// - 1件以上のPDFをqpdfでリニアライズし、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFが読み取り可能なPDFであること
//
// Mocked:
// - なし。実qpdfと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - commandからのURI選択

import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { linearizePdfFiles } from '../../src/operations/pdf/linearize_pdf.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';
import { readConfiguredQpdfPath } from '../helpers/external_tool_settings.js';

suite('PDFリニアライズ', () => {
  test('qpdfでPDFをリニアライズして出力する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-linearize-test-'));
    const sourcePath = path.join(workspacePath, 'multi-page-table.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);

    try {
      await linearizePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        qpdfPath: readConfiguredQpdfPath(),
        runId: 'run',
      });

      const source = await PDFDocument.load(await readFile(sourcePath));
      const output = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(output.getPageCount(), source.getPageCount());
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('出力先が既に存在する場合は何も作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-linearize-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      linearizePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        qpdfPath: readConfiguredQpdfPath(),
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('キャンセルされた場合は出力しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-linearize-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath);
    abortController.abort();

    await assert.rejects(
      linearizePdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        qpdfPath: readConfiguredQpdfPath(),
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });
});

async function writePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  document.addPage([100, 200]);
  await writeFile(filePath, await document.save());
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
