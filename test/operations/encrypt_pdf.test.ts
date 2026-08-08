// Test target:
// - 指定パスワードでPDFを暗号化し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFがパスワードで保護されていること
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

import { encryptPdfFiles } from '../../src/operations/pdf/encrypt_pdf.js';
import { loadMupdf } from '../../src/operations/pdf/mupdf.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';

const password = 'secret-password';

suite('PDFのパスワード暗号化', () => {
  test('multi-page-table.pdfを指定パスワードでmupdfにより暗号化して出力し、needsPassword=trueで正しいパスワードでのみ認証できるPDFになっていることを検証する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-encrypt-test-'));
    const sourcePath = path.join(workspacePath, 'multi-page-table.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);

    try {
      await encryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
        runId: 'run',
      });

      const mupdf = await loadMupdf();
      const encrypted = mupdf.Document.openDocument(await readFile(outputPath));
      try {
        assert.equal(encrypted.needsPassword(), true);
        assert.equal(encrypted.authenticatePassword(password) === 0, false);
        assert.match(encrypted.getMetaData('encryption') ?? '', /AES|Standard/);
      } finally {
        encrypted.destroy();
      }

      const wrongPasswordDocument = mupdf.Document.openDocument(await readFile(outputPath));
      try {
        assert.equal(wrongPasswordDocument.authenticatePassword('wrong-password'), 0);
      } finally {
        wrongPasswordDocument.destroy();
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('出力先に既存ファイルがある場合はOutput file already existsエラーで暗号化前に失敗し、既存内容を変更しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-encrypt-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath);
    await writeFile(outputPath, 'existing');

    await assert.rejects(
      encryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });

  test('abort済みのsignalを渡すと暗号化を開始せずAbortErrorで失敗し、出力を作成しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-encrypt-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    const abortController = new AbortController();
    await writePdf(sourcePath);
    abortController.abort();

    await assert.rejects(
      encryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
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
