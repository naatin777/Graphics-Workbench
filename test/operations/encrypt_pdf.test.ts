// Test target:
// - 指定パスワードでPDFを暗号化し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFがパスワードで保護されていること
//
// Mocked:
// - なし。実qpdfと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - パスワード入力プロンプト

import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PDFDocument } from 'pdf-lib';

import { encryptPdfFiles } from '../../src/operations/pdf/encrypt_pdf.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';

const execFileAsync = promisify(execFile);
const password = 'secret-password';

suite('PDF暗号化', () => {
  test('qpdfでパスワード付きPDFを生成し、正しいパスワードで復号できる', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-encrypt-test-'));
    const sourcePath = path.join(workspacePath, 'multi-page-table.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);

    try {
      await encryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
        qpdfPath: 'qpdf',
        runId: 'run',
      });

      const wrongPasswordPath = path.join(workspacePath, 'wrong.pdf');
      await assert.rejects(decryptWithQpdf(outputPath, wrongPasswordPath, 'wrong-password'));

      const decryptedPath = path.join(workspacePath, 'decrypted.pdf');
      await decryptWithQpdf(outputPath, decryptedPath, password);
      const decrypted = await PDFDocument.load(await readFile(decryptedPath));
      assert.ok(decrypted.getPageCount() >= 1);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('出力先が既に存在する場合は何も作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-encrypt-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      encryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
        qpdfPath: 'qpdf',
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('キャンセルされた場合は出力しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-encrypt-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath);
    abortController.abort();

    await assert.rejects(
      encryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
        qpdfPath: 'qpdf',
        runtime: { signal: abortController.signal },
      }),
      { name: 'AbortError' },
    );

    await assert.rejects(access(outputPath));
  });
});

async function decryptWithQpdf(sourcePath: string, outputPath: string, pdfPassword: string): Promise<void> {
  await execFileAsync('qpdf', ['--decrypt', `--password=${pdfPassword}`, sourcePath, outputPath], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function writePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  document.addPage([100, 200]);
  await writeFile(filePath, await document.save());
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
