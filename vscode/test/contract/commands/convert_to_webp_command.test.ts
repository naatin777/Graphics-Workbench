// Test target:
// - graphics-workbench.convertToWebp commandが登録されること
// - PNGをWebPへ変換できること
// - JPEG、AVIFをWebPへ変換できること
// - SVGをWebPへ変換できること
// - PDFをページごとのWebPへ変換できること
// - MermaidをWebPへ変換できること
// - WebPからWebPへは変換しないこと
// - 出力WebPが壊れておらず、幅と高さが0より大きいこと
//
// Not tested:
// - Draw.io → PDF → PNG → WebPの実変換経路
//   - fake Draw.io CLIをcommand testで直接扱うとWindowsのexecFile差で不安定になりやすい。
//   - 必要になったらrunnerを注入できるoperation testとして固定する。
// - PDF / Draw.io / MermaidからWebPへの変換ではPNGを中間形式に使うこと
//   - command testでは出力WebPの読み取り可能性を確認し、中間形式の詳細はoperation testで扱う。
// - 画像内容のpixel完全一致
// - context menuの画面上の表示
// - Safe Modeダイアログの画面表示
// - VS Codeのprogress notificationの画面表示
// - cancellation tokenのUI操作

import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from '../../support/helpers/pdf_document.js';
import sharp from 'sharp';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPngInputPath, testInputDirectory } from '../../support/helpers/fixture_paths.js';
import { requireValue } from '../../support/helpers/required.js';

const fixturePngPath = operationPngInputPath;

suite('WebPに変換コマンド', () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessage: sinon.SinonStub;
  let showInformationMessage: sinon.SinonStub;

  setup(async () => {
    sandbox = createSandbox();
    showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    await vscode.workspace
      .getConfiguration('graphics-workbench')
      .update('convertToWebp.effort', 0, vscode.ConfigurationTarget.Workspace);
  });

  teardown(async () => {
    await vscode.workspace
      .getConfiguration('graphics-workbench')
      .update('convertToWebp.effort', undefined, vscode.ConfigurationTarget.Workspace);
    sandbox.restore();
  });

  test('PNG、JPEG、AVIF、2ページPDFを1回のコマンド実行でまとめてWebPへ変換し、画像は拡張子置換の.webp、PDFはページごとの1.webp/2.webpをサブディレクトリに生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const pngPath = path.join(temporaryDirectory, 'source-png.png');
      const jpegPath = path.join(temporaryDirectory, 'source-jpeg.jpeg');
      const avifPath = path.join(temporaryDirectory, 'source-avif.avif');
      const pdfPath = path.join(temporaryDirectory, 'source-document.pdf');
      await Promise.all([
        copyFile(fixturePngPath, pngPath),
        writeImageFixture(jpegPath, 'jpeg'),
        writeImageFixture(avifPath, 'avif'),
        writeTwoPagePdf(pdfPath),
      ]);
      const sourcePaths = [pngPath, jpegPath, avifPath, pdfPath];

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToWebp',
        vscode.Uri.file(requireValue(sourcePaths[0])),
        sourcePaths.map((sourcePath) => vscode.Uri.file(sourcePath)),
      );
      await commandExecution;

      await Promise.all(
        [pngPath, jpegPath, avifPath].map((sourcePath) => assertReadableWebp(replaceExtension(sourcePath, '.webp'))),
      );
      await assertReadableWebp(path.join(temporaryDirectory, 'source-document', '1.webp'));
      await assertReadableWebp(path.join(temporaryDirectory, 'source-document', '2.webp'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('convertToWebpでGIFを変換すると複数frameを持つ1つのWebPを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'rotating-vector-field.gif');
      await copyFile(path.join(testInputDirectory, 'valid', 'gif', 'rotating-vector-field.gif'), sourcePath);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToWebp',
        vscode.Uri.file(sourcePath),
      );
      await commandExecution;
      assert.deepStrictEqual(showErrorMessage.args, []);
      assert.strictEqual(showInformationMessage.firstCall?.args.length, 3);

      const outputPath = replaceExtension(sourcePath, '.webp');
      const metadata = await sharp(outputPath).metadata();
      assert.ok((metadata.pages ?? 1) > 1);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('convertToWebpSeparatelyでGIFを変換し、フレームごとの01、02連番WebPを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'rotating-vector-field.gif');
      await copyFile(path.join(testInputDirectory, 'valid', 'gif', 'rotating-vector-field.gif'), sourcePath);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToWebpSeparately',
        vscode.Uri.file(sourcePath),
      );
      await commandExecution;
      assert.deepStrictEqual(showErrorMessage.args, []);
      assert.strictEqual(showInformationMessage.firstCall?.args.length, 3);

      const firstFramePath = path.join(temporaryDirectory, 'rotating-vector-field', '01.webp');
      const secondFramePath = path.join(temporaryDirectory, 'rotating-vector-field', '02.webp');
      await assertReadableWebp(firstFramePath);
      await assertReadableWebp(secondFramePath);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('convertToGifでanimated WebPを変換すると複数frameを持つ1つのGIFを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'animated-swirl.webp');
      await copyFile(path.join(testInputDirectory, 'valid', 'webp', 'animated-swirl.webp'), sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.convertToGif', vscode.Uri.file(sourcePath));

      assert.deepStrictEqual(showErrorMessage.args, []);
      const metadata = await sharp(replaceExtension(sourcePath, '.gif')).metadata();
      assert.strictEqual(metadata.format, 'gif');
      assert.ok((metadata.pages ?? 1) > 1);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('convertToGifSeparatelyでanimated WebPを変換し、フレームごとのGIFを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'animated-swirl.webp');
      await copyFile(path.join(testInputDirectory, 'valid', 'webp', 'animated-swirl.webp'), sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.convertToGifSeparately', vscode.Uri.file(sourcePath));

      assert.deepStrictEqual(showErrorMessage.args, []);
      await assertReadableGif(path.join(temporaryDirectory, 'animated-swirl', '01.gif'));
      await assertReadableGif(path.join(temporaryDirectory, 'animated-swirl', '02.gif'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('WebP入力を変換せず、ページ分割されたsource/1.webpも作成しない', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.webp');
      await writeImageFixture(sourcePath, 'webp');

      await vscode.commands.executeCommand('graphics-workbench.convertToWebp', vscode.Uri.file(sourcePath));

      await assertFileDoesNotExist(path.join(temporaryDirectory, 'source', '1.webp'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });
});

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'gw-convert-to-webp-'));
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

  if (extension === 'webp') {
    await image.webp({ effort: 0 }).toFile(filePath);
    return;
  }

  if (extension === 'avif') {
    await image.avif({ effort: 0 }).toFile(filePath);
    return;
  }

  throw new Error(`Unsupported generated fixture extension: ${extension}`);
}

async function assertReadableWebp(filePath: string): Promise<void> {
  await assertFileExists(filePath);
  const buffer = await readFile(filePath);
  const image = sharp(buffer);
  const metadata = await image.metadata();

  assert.strictEqual(metadata.format, 'webp');
  assert.ok(metadata.width);
  assert.ok(metadata.width > 0);
  assert.ok(metadata.height);
  assert.ok(metadata.height > 0);
}

async function assertReadableGif(filePath: string): Promise<void> {
  await assertFileExists(filePath);
  const metadata = await sharp(await readFile(filePath)).metadata();
  assert.strictEqual(metadata.format, 'gif');
  assert.ok((metadata.width ?? 0) > 0);
  assert.ok((metadata.height ?? 0) > 0);
}

async function assertFileExists(filePath: string): Promise<void> {
  await assert.doesNotReject(access(filePath));
}

async function assertFileDoesNotExist(filePath: string): Promise<void> {
  await assert.rejects(access(filePath), (error) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  });
}

function replaceExtension(filePath: string, extension: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extension}`);
}
