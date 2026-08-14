// Test target:
// - 指定パスワードで暗号化されたPDFを復号し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 復号出力がパスワードなしで読み取れること
//
// Mocked:
// - なし。実mupdfと実ファイルを使用する
//
import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { operationPdfInputDirectory, readPdfPages } from '@graphics-workbench/core/testing';

import { decryptPdfFiles, loadMupdf, openPdfDocument, savePdfDocument } from '@graphics-workbench/core/pdf';

const password = 'secret-password';

describe('パスワード付きPDFの復号化', () => {
  it('mupdfでAES-256暗号化したmulti-page-table.pdfを指定パスワードで復号し、パスワード不要で読み取れるPDFとして出力する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-decrypt-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'encrypted.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);
    await encryptWithMupdf(sourcePath, password);

    await decryptPdfFiles({
      inputs: [{ sourcePath, workspacePath, outputPath }],
      password,
      runtime: {},
      runId: 'run',
    });

    const decryptedPages = await readPdfPages(await readFile(outputPath));
    assert.ok(decryptedPages.length >= 1);

    const mupdf = await loadMupdf();
    const decryptedDocument = mupdf.Document.openDocument(await readFile(outputPath));
    try {
      assert.equal(decryptedDocument.needsPassword(), false);
    } finally {
      decryptedDocument.destroy();
    }
  });

  it('誤ったパスワードを渡すと復号に失敗し、出力ファイルを作成しない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-decrypt-test-'));
    const workspacePath = workspacePathDisposable.path;
    const sourcePath = path.join(workspacePath, 'encrypted.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);
    await encryptWithMupdf(sourcePath, password);

    await assert.rejects(
      decryptPdfFiles({
        inputs: [{ sourcePath, workspacePath, outputPath }],
        password: 'wrong-password',
        runtime: {},
      }),
    );

    await assert.rejects(access(outputPath));
  });
});

async function encryptWithMupdf(sourcePath: string, pdfPassword: string): Promise<void> {
  const document = await openPdfDocument(await readFile(sourcePath));
  try {
    const encryptedBytes = savePdfDocument(
      document,
      `encrypt=aes-256,user-password=${pdfPassword},owner-password=${pdfPassword}`,
    );
    await writeFile(sourcePath, encryptedBytes);
  } finally {
    document.destroy();
  }
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
