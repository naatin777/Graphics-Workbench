// Test target:
// - 指定パスワードで暗号化されたPDFを復号し、全成功後に出力すること
// - 既存出力、キャンセル時に出力を反映しないこと
// - 復号出力がパスワードなしで読み取れること
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

import { decryptPdfFiles } from '../../src/operations/pdf/decrypt_pdf.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';
import { readConfiguredQpdfPath } from '../helpers/external_tool_settings.js';

const execFileAsync = promisify(execFile);
const password = 'secret-password';

suite('PDF復号化', () => {
  test('qpdfで暗号化PDFを復号し、パスワードなしで読み取れる', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-decrypt-test-'));
    const sourcePath = path.join(workspacePath, 'encrypted.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);
    await encryptWithQpdf(sourcePath, password);

    try {
      await decryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password,
        qpdfPath: readConfiguredQpdfPath(),
        runId: 'run',
      });

      const decrypted = await PDFDocument.load(await readFile(outputPath));
      assert.ok(decrypted.getPageCount() >= 1);

      const encryptionInfo = await execFileAsync(readConfiguredQpdfPath(), ['--show-encryption', outputPath], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      assert.match(encryptionInfo.stdout, /File is not encrypted/);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('誤ったパスワードでは復号に失敗し出力を残さない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-decrypt-test-'));
    const sourcePath = path.join(workspacePath, 'encrypted.pdf');
    const outputPath = path.join(workspacePath, 'output.pdf');
    await copyFile(fixturePath('multi-page-table.pdf'), sourcePath);
    await encryptWithQpdf(sourcePath, password);

    await assert.rejects(
      decryptPdfFiles({
        jobs: [{ sourcePath, workspacePath, outputPath }],
        password: 'wrong-password',
        qpdfPath: readConfiguredQpdfPath(),
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
        qpdfPath: readConfiguredQpdfPath(),
      }),
      /Output file already exists/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing');
  });
});

async function encryptWithQpdf(sourcePath: string, pdfPassword: string): Promise<void> {
  const encryptedPath = `${sourcePath}.encrypted`;
  await execFileAsync(
    readConfiguredQpdfPath(),
    ['--encrypt', pdfPassword, pdfPassword, '256', '--', sourcePath, encryptedPath],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  await writeFile(sourcePath, await readFile(encryptedPath));
}

async function writePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  document.addPage([100, 200]);
  await writeFile(filePath, await document.save());
}

function fixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}
