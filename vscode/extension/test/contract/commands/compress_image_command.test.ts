// Test target:
// - graphics-workbench.compressImage commandが登録されること
// - PNG、JPEG、WebP、AVIF、マルチページTIFF入力を1回のコマンド実行でまとめて圧縮し、同名の_compressed.<ext>を出力すること
// - 出力画像が壊れておらず、幅と高さが0より大きいこと
//
// Not tested:
// - 画像内容のpixel完全一致
// - Safe Modeダイアログの画面表示
// - VS Codeのprogress notificationの画面表示
// - cancellation tokenのUI操作

import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPngInputPath, testInputDirectory } from '../../support/helpers/fixture_paths.js';
import { runCommandAndClearNotificationsUntilDone } from '../../support/helpers/vscode_command.js';
import { requireValue } from '../../support/helpers/required.js';

const fixturePngPath = operationPngInputPath;

suite('画像圧縮コマンド', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('PNG、JPEG、WebP、AVIF、マルチページTIFFを1回のコマンド実行でまとめて圧縮し、それぞれ同名の_compressed.<ext>を生成する', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-compress-image-'),
    );
    const pngPath = path.join(workspacePath.path, 'source.png');
    const jpegPath = path.join(workspacePath.path, 'source.jpg');
    const webpPath = path.join(workspacePath.path, 'source.webp');
    const avifPath = path.join(workspacePath.path, 'source.avif');
    const tiffPath = path.join(workspacePath.path, 'source.tiff');
    await Promise.all([
      copyFile(fixturePngPath, pngPath),
      writeImageFixture(jpegPath, 'jpeg'),
      writeImageFixture(webpPath, 'webp'),
      writeImageFixture(avifPath, 'avif'),
      copyFile(path.join(testInputDirectory, 'valid', 'tiff', 'heatmap.tiff'), tiffPath),
    ]);
    const sourcePaths = [pngPath, jpegPath, webpPath, avifPath, tiffPath];

    const commandExecution = vscode.commands.executeCommand(
      'graphics-workbench.compressImage',
      vscode.Uri.file(requireValue(sourcePaths[0])),
      sourcePaths.map((sourcePath) => vscode.Uri.file(sourcePath)),
    );
    await runCommandAndClearNotificationsUntilDone(commandExecution);

    await Promise.all([
      assertReadableImage(path.join(workspacePath.path, 'source_compressed.png'), 'png'),
      assertReadableImage(path.join(workspacePath.path, 'source_compressed.jpg'), 'jpeg'),
      assertReadableImage(path.join(workspacePath.path, 'source_compressed.webp'), 'webp'),
      assertReadableImage(path.join(workspacePath.path, 'source_compressed.avif'), 'heif'),
      assertMultipageTiff(path.join(workspacePath.path, 'source_compressed.tiff')),
    ]);
  });
});

async function writeImageFixture(filePath: string, extension: string): Promise<void> {
  const fixtureBuffer = await readFile(fixturePngPath);
  const image = sharp(fixtureBuffer);

  if (extension === 'jpeg') {
    await image.jpeg().toFile(filePath);
    return;
  }

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

async function assertReadableImage(filePath: string, expectedFormat: string): Promise<void> {
  await assert.doesNotReject(access(filePath));
  const buffer = await readFile(filePath);
  const metadata = await sharp(buffer).metadata();

  assert.strictEqual(metadata.format, expectedFormat);
  assert.ok(metadata.width && metadata.width > 0);
  assert.ok(metadata.height && metadata.height > 0);
}

async function assertMultipageTiff(filePath: string): Promise<void> {
  await assert.doesNotReject(access(filePath));
  const metadata = await sharp(await readFile(filePath)).metadata();
  assert.strictEqual(metadata.format, 'tiff');
  assert.strictEqual(metadata.pages, 4);
}
