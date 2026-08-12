// Test target:
// - 指定パスワードでPDFを暗号化し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFがパスワードで保護されていること
//
// Mocked:
// - なし。実mupdfと実ファイルを使用する
//
import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../../../test-support/pdf_document.js';

import { encryptPdfFiles, loadMupdf } from '@graphics-workbench/core/pdf';
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
        inputs: [{ sourcePath, workspacePath, outputPath }],
        password,
        runtime: {},
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

  test('MuPDF option parserが扱えないカンマまたは等号を含むパスワードは暗号化を開始せず明示的に拒否する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-encrypt-password-validation-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await writePdf(sourcePath);

    try {
      for (const invalidPassword of ['bad,password', 'bad=password']) {
        await assert.rejects(
          encryptPdfFiles({
            inputs: [{ sourcePath, workspacePath, outputPath }],
            password: invalidPassword,
            runtime: {},
          }),
          /passwords cannot contain/iu,
        );
        await assert.rejects(access(outputPath));
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
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
