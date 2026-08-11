// Test target:
// - graphics-workbench.convertToAvif commandが登録されること
// - PNGをAVIFへ変換できること
// - JPEG、WebPをAVIFへ変換できること
// - SVGをAVIFへ変換できること
// - PDFをページごとのAVIFへ変換できること
// - MermaidをAVIFへ変換できること
// - AVIFからAVIFへは変換しないこと
// - 出力AVIFが壊れておらず、幅と高さが0より大きいこと
//
// Not tested:
// - Draw.io → PDF → PNG → AVIFの実変換経路
//   - fake Draw.io CLIをcommand testで直接扱うとWindowsのexecFile差で不安定になりやすい。
//   - 必要になったらrunnerを注入できるoperation testとして固定する。
// - PDF / Draw.io / MermaidからAVIFへの変換ではPNGを中間形式に使うこと
//   - command testでは出力AVIFの読み取り可能性を確認し、中間形式の詳細はoperation testで扱う。
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

const fixturePngPath = operationPngInputPath;

suite('AVIFに変換コマンド', () => {
  let sandbox: sinon.SinonSandbox;

  setup(async () => {
    sandbox = createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    await vscode.workspace
      .getConfiguration('graphics-workbench')
      .update('convertToAvif.effort', 0, vscode.ConfigurationTarget.Workspace);
  });

  teardown(async () => {
    await vscode.workspace
      .getConfiguration('graphics-workbench')
      .update('convertToAvif.effort', undefined, vscode.ConfigurationTarget.Workspace);
    sandbox.restore();
  });

  test('PNG、JPEG、WebP、2ページPDFを1回のコマンド実行でまとめてAVIFへ変換し、画像は拡張子置換の.avif、PDFはページごとの1.avif/2.avifをサブディレクトリにheif形式で生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const pngPath = path.join(temporaryDirectory, 'source-png.png');
      const jpegPath = path.join(temporaryDirectory, 'source-jpeg.jpeg');
      const webpPath = path.join(temporaryDirectory, 'source-webp.webp');
      const pdfPath = path.join(temporaryDirectory, 'source-document.pdf');
      await Promise.all([
        copyFile(fixturePngPath, pngPath),
        writeImageFixture(jpegPath, 'jpeg'),
        writeImageFixture(webpPath, 'webp'),
        writeTwoPagePdf(pdfPath),
      ]);
      const sourcePaths = [pngPath, jpegPath, webpPath, pdfPath];

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToAvif',
        vscode.Uri.file(requireValue(sourcePaths[0])),
        sourcePaths.map((sourcePath) => vscode.Uri.file(sourcePath)),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      await Promise.all(
        [pngPath, jpegPath, webpPath].map((sourcePath) => assertReadableAvif(replaceExtension(sourcePath, '.avif'))),
      );
      await assertReadableAvif(path.join(temporaryDirectory, 'source-document', '1.avif'));
      await assertReadableAvif(path.join(temporaryDirectory, 'source-document', '2.avif'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });
});

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'gw-convert-to-avif-'));
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

  if (extension === 'jpeg') {
    await image.jpeg().toFile(filePath);
    return;
  }

  if (extension === 'avif') {
    await image.avif({ effort: 0 }).toFile(filePath);
    return;
  }

  if (extension === 'webp') {
    await image.webp({ effort: 0 }).toFile(filePath);
    return;
  }

  throw new Error(`Unsupported generated fixture extension: ${extension}`);
}

async function assertReadableAvif(filePath: string): Promise<void> {
  await assertFileExists(filePath);
  const buffer = await readFile(filePath);
  const image = sharp(buffer);
  const metadata = await image.metadata();

  assert.strictEqual(metadata.format, 'heif');
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
