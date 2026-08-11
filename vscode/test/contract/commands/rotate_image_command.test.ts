// Test target:
// - graphics-workbench.rotateImage commandが登録されること
// - QuickPickで選択した角度でラスタ画像を回転し、-rotated接尾辞の出力を生成すること
// - 複数画像を1回のコマンド実行でまとめて回転できること
// - 出力パス設定がラスタ拡張子でない場合に変換開始前に拒否すること
// - 非ラスタ入力（SVG）を変換開始前に拒否すること
// - 90/180/270以外の角度を選んだ場合は出力を生成しないこと
// - QuickPickでキャンセルした場合は変換を開始しないこと
//
// Mocked:
// - 通知API
// - 角度選択のQuickPick
// - Safe Modeダイアログ
//
// Not tested:
// - context menuの画面上の表示
// - VS Codeのprogress notificationの画面表示

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import sharp from 'sharp';
import * as vscode from 'vscode';

import { runCommandAndClearNotificationsUntilDone } from '../../support/helpers/vscode_command.js';
import { withWorkspaceSettings } from '../../support/helpers/workspace_settings.js';

suite('画像の回転コマンド', () => {
  let sandbox: sinon.SinonSandbox;
  let showQuickPick: sinon.SinonStub;

  setup(() => {
    sandbox = createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
    stubPickAngle(showQuickPick, 90);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('選択したPNGを90度回転し、-rotated接尾辞の出力PNGを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.png');
      await writeImage(sourcePath, 4, 2);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.rotateImage',
        vscode.Uri.file(sourcePath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const metadata = await sharp(await readFile(path.join(temporaryDirectory, 'source-rotated.png'))).metadata();
      assert.strictEqual(metadata.format, 'png');
      assert.strictEqual(metadata.width, 2);
      assert.strictEqual(metadata.height, 4);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('PNGとJPEGを1回のコマンド実行でまとめて回転する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const pngPath = path.join(temporaryDirectory, 'source.png');
      const jpegPath = path.join(temporaryDirectory, 'source.jpg');
      await writeImage(pngPath, 4, 2);
      await writeImage(jpegPath, 6, 3);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.rotateImage',
        vscode.Uri.file(pngPath),
        [vscode.Uri.file(pngPath), vscode.Uri.file(jpegPath)],
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const pngMetadata = await sharp(await readFile(path.join(temporaryDirectory, 'source-rotated.png'))).metadata();
      assert.strictEqual(pngMetadata.format, 'png');
      assert.strictEqual(pngMetadata.width, 2);
      assert.strictEqual(pngMetadata.height, 4);

      const jpegMetadata = await sharp(await readFile(path.join(temporaryDirectory, 'source-rotated.jpg'))).metadata();
      assert.strictEqual(jpegMetadata.format, 'jpeg');
      assert.strictEqual(jpegMetadata.width, 3);
      assert.strictEqual(jpegMetadata.height, 6);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('出力パス設定がラスタ拡張子でない場合は、回転処理（withProgress）を開始せず、無効な拡張子のエラー通知を出す', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.png');
      await writeImage(sourcePath, 4, 2);
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const withProgress = sandbox
        .stub(vscode.window, 'withProgress')
        .rejects(new Error('withProgress must not be called for an invalid output path.'));

      await withWorkspaceSettings(
        { 'graphics-workbench.outputPath.rotateImage': '${fileDirname}/result.txt' },
        async () => {
          const commandExecution = vscode.commands.executeCommand(
            'graphics-workbench.rotateImage',
            vscode.Uri.file(sourcePath),
          );
          await runCommandAndClearNotificationsUntilDone(commandExecution);
        },
      );

      assert.match(showErrorMessage.firstCall.args[0] ?? '', /invalid output extension/i);
      assert.ok(withProgress.notCalled);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('SVGなど非ラスタの入力を選択した場合は、回転処理（withProgress）を開始せず、エラー通知を出す', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.svg');
      await writeFile(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const withProgress = sandbox
        .stub(vscode.window, 'withProgress')
        .rejects(new Error('withProgress must not be called.'));

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.rotateImage',
        vscode.Uri.file(sourcePath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.match(showErrorMessage.firstCall.args[0] ?? '', /only raster image files can be rotated/i);
      assert.ok(withProgress.notCalled);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('QuickPickで角度を選択せずにキャンセルした場合は、回転を開始しない', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.png');
      await writeImage(sourcePath, 4, 2);
      showQuickPick.resolves(undefined);
      const withProgress = sandbox
        .stub(vscode.window, 'withProgress')
        .rejects(new Error('withProgress must not be called after cancellation.'));

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.rotateImage',
        vscode.Uri.file(sourcePath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.ok(withProgress.notCalled);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('QuickPickで90/180/270以外の角度を選んだ場合は、出力を生成せずエラー通知を出す', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.png');
      await writeImage(sourcePath, 4, 2);
      showQuickPick.resolves({ label: '45°', angle: 45 });
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.rotateImage',
        vscode.Uri.file(sourcePath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.match(showErrorMessage.firstCall.args[0] ?? '', /unsupported rotation angle/i);
      await assert.rejects(readFile(path.join(temporaryDirectory, 'source-rotated.png')));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });
});

function stubPickAngle(showQuickPick: sinon.SinonStub, angle: number): void {
  showQuickPick.resolves({ label: `${angle}°`, angle });
}

async function writeImage(filePath: string, width: number, height: number): Promise<void> {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toFile(filePath);
}

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'gw-rotate-image-'));
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
