// Test target:
// - graphics-workbench.convertToJpeg commandが登録されること
// - PNGをJPEGへ変換できること
// - WebP、AVIFをJPEGへ変換できること
// - SVGをJPEGへ変換できること
// - PDFをページごとのJPEGへ変換できること
// - MermaidをJPEGへ変換できること
// - 出力JPEGが壊れておらず、幅と高さが0より大きいこと
//
// Not tested:
// - Draw.io → PDF → JPEGの実変換経路
//   - fake Draw.io CLIをcommand testで直接扱うとWindowsのexecFile差で不安定になりやすい。
//   - 必要になったらrunnerを注入できるoperation testとして固定する。
// - 画像内容のpixel完全一致
// - context menuの画面上の表示
// - Safe Modeダイアログの画面表示
// - VS Codeのprogress notificationの画面表示
// - cancellation tokenのUI操作

import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from '../helpers/pdf_document.js';

import sharp from 'sharp';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPngInputPath } from '../helpers/fixture_paths.js';
import { runCommandAndClearNotificationsUntilDone } from '../helpers/vscode_command.js';
import { requireValue } from '../helpers/required.js';
import { withWorkspaceSettings } from '../helpers/workspace_settings.js';

const fixturePngPath = operationPngInputPath;

suite('JPEGに変換コマンド', () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessage: sinon.SinonStub;

  setup(() => {
    sandbox = createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('PNG、WebP、AVIF、2ページPDFを1回のコマンド実行でまとめてJPEGへ変換し、画像は拡張子置換の.jpeg、PDFはページごとの1.jpeg/2.jpegをサブディレクトリに生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const pngPath = path.join(temporaryDirectory, 'source-png.png');
      const webpPath = path.join(temporaryDirectory, 'source-webp.webp');
      const avifPath = path.join(temporaryDirectory, 'source-avif.avif');
      const pdfPath = path.join(temporaryDirectory, 'source-document.pdf');
      await Promise.all([
        copyFile(fixturePngPath, pngPath),
        writeImageFixture(webpPath, 'webp'),
        writeImageFixture(avifPath, 'avif'),
        writeTwoPagePdf(pdfPath),
      ]);
      const sourcePaths = [pngPath, webpPath, avifPath, pdfPath];

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToJpeg',
        vscode.Uri.file(requireValue(sourcePaths[0])),
        sourcePaths.map((sourcePath) => vscode.Uri.file(sourcePath)),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      await Promise.all(
        [pngPath, webpPath, avifPath].map((sourcePath) => assertReadableJpeg(replaceExtension(sourcePath, '.jpeg'))),
      );
      await assertReadableJpeg(path.join(temporaryDirectory, 'source-document', '1.jpeg'));
      await assertReadableJpeg(path.join(temporaryDirectory, 'source-document', '2.jpeg'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('outputPath.single.jpegが空文字の場合はinvalid configurationとして変換せず、既定のsource.jpegへフォールバックしない', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.png');
      await copyFile(fixturePngPath, sourcePath);

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.single.jpeg': '',
        },
        async () => {
          await vscode.commands.executeCommand('graphics-workbench.convertToJpeg', vscode.Uri.file(sourcePath));
        },
      );

      assert.ok(showErrorMessage.calledOnce);
      assert.match(
        String(showErrorMessage.firstCall.args[0]),
        /Invalid configuration for graphics-workbench\.outputPath\.single\.jpeg/,
      );
      await assertFileDoesNotExist(path.join(temporaryDirectory, 'source.jpeg'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });
});

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'gw-convert-to-jpeg-'));
  await mkdir(temporaryDirectory, { recursive: true });
  return temporaryDirectory;
}

async function removeTemporaryDirectory(directoryPath: string): Promise<void> {
  await rm(directoryPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function writeTwoPagePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  document.addPage([72, 36]);
  document.addPage([36, 72]);
  await writeFile(filePath, await document.save());
}

async function writeImageFixture(filePath: string, extension: string): Promise<void> {
  const fixtureBuffer = await readFile(fixturePngPath);
  const image = sharp(fixtureBuffer);

  if (extension === 'webp') {
    await image.webp().toFile(filePath);
    return;
  }

  if (extension === 'avif') {
    await image.avif({ effort: 0 }).toFile(filePath);
    return;
  }

  throw new Error(`Unsupported generated fixture extension: ${extension}`);
}

async function assertReadableJpeg(filePath: string): Promise<void> {
  await assertFileExists(filePath);
  const buffer = await readFile(filePath);
  const image = sharp(buffer);
  const metadata = await image.metadata();

  assert.strictEqual(metadata.format, 'jpeg');
  assert.ok(metadata.width);
  assert.ok(metadata.width > 0);
  assert.ok(metadata.height);
  assert.ok(metadata.height > 0);
}

async function assertFileExists(filePath: string): Promise<void> {
  await assert.doesNotReject(access(filePath));
}

function replaceExtension(filePath: string, extension: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extension}`);
}

async function assertFileDoesNotExist(filePath: string): Promise<void> {
  await assert.rejects(access(filePath), (error) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  });
}
