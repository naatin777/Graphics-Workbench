// Test target:
// - 指定パスワードでPDFを暗号化し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 出力PDFがパスワードで保護されていること
//
// Mocked:
// - なし。実mupdfと実ファイルを使用する
//
import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { operationPdfInputDirectory, createPdfFixture } from '@graphics-workbench/core/testing';

import { encryptPdfFiles, loadMupdf } from '@graphics-workbench/core/pdf';

const password = 'secret-password';

describe('PDFのパスワード暗号化', () => {
  it('multi-page-table.pdfを指定パスワードでmupdfにより暗号化して出力し、needsPassword=trueで正しいパスワードでのみ認証できるPDFになっていることを検証する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-encrypt-test-'));
    const workspacePath = workspacePathDisposable.path;
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
    }
  });

  it('MuPDF option parserが扱えないカンマまたは等号を含むパスワードは暗号化を開始せず明示的に拒否する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(
      path.join(os.tmpdir(), 'gw-encrypt-password-validation-'),
    );
    const workspacePath = workspacePathDisposable.path;
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
    }
  });
});

async function writePdf(filePath: string): Promise<void> {
  const bytes = await createPdfFixture({ pages: [{ mediaBox: [0, 0, 100, 200] }] });
  await writeFile(filePath, bytes);
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
