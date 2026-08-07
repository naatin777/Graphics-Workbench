// Test target:
// - 指定パスワードで暗号化されたPDFを復号し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 復号出力がパスワードなしで読み取れること
//
// Mocked:
// - なし。実mupdfと実ファイルを使用する
//
// Not tested:
// - VS CodeのwithProgress UI
// - パスワード入力プロンプト

import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { decryptPdfFiles } from '../../src/operations/pdf/decrypt_pdf.js';
import { loadMupdf, openPdfDocument, savePdfDocument } from '../../src/operations/pdf/mupdf.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';

const password = 'secret-password';

suite('PDF復号化', () => {
  test('mupdfで暗号化PDFを復号し、パスワードなしで読み取れる', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-decrypt-test-'));
    const sourcePath = path.join(workspacePath, 'encrypted.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);
    await encryptWithMupdf(sourcePath, password);

    try {
      await decryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
        runId: 'run',
      });

      const decrypted = await PDFDocument.load(await readFile(outputPath));
      assert.ok(decrypted.getPageCount() >= 1);

      const mupdf = await loadMupdf();
      const decryptedDocument = mupdf.Document.openDocument(await readFile(outputPath));
      try {
        assert.equal(decryptedDocument.needsPassword(), false);
      } finally {
        decryptedDocument.destroy();
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('誤ったパスワードでは復号に失敗し出力を残さない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-decrypt-test-'));
    const sourcePath = path.join(workspacePath, 'encrypted.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);
    await encryptWithMupdf(sourcePath, password);

    await assert.rejects(
      decryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password: 'wrong-password',
      }),
    );

    await assert.rejects(access(outputPath));
  });

  test('出力先が既に存在する場合は何も作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-decrypt-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      decryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });
});

async function encryptWithMupdf(sourcePath: string, pdfPassword: string): Promise<void> {
  const document = await openPdfDocument(await readFile(sourcePath));
  const encryptedBytes = savePdfDocument(
    document,
    `encrypt=aes-256,user-password=${pdfPassword},owner-password=${pdfPassword}`,
  );
  await writeFile(sourcePath, encryptedBytes);
}

async function writePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  document.addPage([100, 200]);
  await writeFile(filePath, await document.save());
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
