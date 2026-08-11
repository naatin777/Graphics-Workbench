// Test target:
// - PDFを出力する全commandが、outputPath設定が.pdfで終わらない場合に変換開始前に拒否すること
//
// Mocked:
// - 通知API
// - 確認UI (quick pick, input box)
// - progress UI (呼び出されないことの検証)
// - Webview panel (作成されないことの検証)
//
// Not tested:
// - 各PDF変換処理本体

import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPdfInputDirectory, testInputDirectory } from '../../support/helpers/fixture_paths.js';
import { requireValue } from '../../support/helpers/required.js';
import { withWorkspaceSettings } from '../../support/helpers/workspace_settings.js';

const invalidPdfTemplate = '${fileDirname}/result.png';

suite('PDF出力コマンドが.pdf以外の出力パス設定を変換開始前に拒否する拡張子検証', () => {
  test('rotatePdfの出力パス設定が.pngで終わる場合は、Quick回転の適用処理（withProgress）を開始せず、無効な拡張子のエラー通知を出す', async () => {
    await withPdfSource(async (sourcePath, sandbox) => {
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const withProgress = sandbox
        .stub(vscode.window, 'withProgress')
        .rejects(new Error('withProgress must not be called for an invalid output path.'));
      sandbox.stub(vscode.window, 'showQuickPick').resolves({ label: '90°', angle: 90 } as vscode.QuickPickItem & {
        angle: number;
      });

      await withWorkspaceSettings({ 'graphics-workbench.outputPath.rotatePdf': invalidPdfTemplate }, async () => {
        await vscode.commands.executeCommand('graphics-workbench.rotatePdf.rotate', vscode.Uri.file(sourcePath));
      });

      assertShowExtensionError(showErrorMessage);
      assert.ok(withProgress.notCalled);
    });
  });

  test('rotatePdfの出力パス設定が.pngで終わる場合は、ConfigureのWebviewを開く前にエラー通知を出して画面を作成しない', async () => {
    await withPdfSource(async (sourcePath, sandbox) => {
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const createWebviewPanel = sandbox.stub(vscode.window, 'createWebviewPanel');

      await withWorkspaceSettings({ 'graphics-workbench.outputPath.rotatePdf': invalidPdfTemplate }, async () => {
        await vscode.commands.executeCommand('graphics-workbench.rotatePdf.configure', vscode.Uri.file(sourcePath));
      });

      assertShowExtensionError(showErrorMessage);
      assert.strictEqual(createWebviewPanel.called, false);
    });
  });

  test('reorderPdfの出力パス設定が.pngで終わる場合は、ConfigureのWebviewを開く前にエラー通知を出して画面を作成しない', async () => {
    await withPdfSource(async (sourcePath, sandbox) => {
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const createWebviewPanel = sandbox.stub(vscode.window, 'createWebviewPanel');

      await withWorkspaceSettings({ 'graphics-workbench.outputPath.reorderPdf': invalidPdfTemplate }, async () => {
        await vscode.commands.executeCommand('graphics-workbench.reorderPdf.configure', vscode.Uri.file(sourcePath));
      });

      assertShowExtensionError(showErrorMessage);
      assert.strictEqual(createWebviewPanel.called, false);
    });
  });

  test('cropPdfの出力パス設定が.pngで終わる場合は、Autoトリミングの適用処理（withProgress）を開始せず、無効な拡張子のエラー通知を出す', async () => {
    await withPdfSource(async (sourcePath, sandbox) => {
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const withProgress = sandbox
        .stub(vscode.window, 'withProgress')
        .rejects(new Error('withProgress must not be called for an invalid output path.'));
      sandbox.stub(vscode.window, 'showQuickPick').resolves({ label: '0 pt', margin: 0 } as vscode.QuickPickItem & {
        margin: number;
      });

      await withWorkspaceSettings({ 'graphics-workbench.outputPath.cropPdf': invalidPdfTemplate }, async () => {
        await vscode.commands.executeCommand('graphics-workbench.cropPdf.auto', vscode.Uri.file(sourcePath));
      });

      assertShowExtensionError(showErrorMessage);
      assert.ok(withProgress.notCalled);
    });
  });

  test('split.pdfの出力パステンプレートが.pngで終わる場合は、ConfigureのWebviewを開く前にエラー通知を出して画面を作成しない', async () => {
    await withPdfSource(async (sourcePath, sandbox) => {
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const createWebviewPanel = sandbox.stub(vscode.window, 'createWebviewPanel');

      await withWorkspaceSettings(
        { 'graphics-workbench.outputPath.split.pdf': '${fileDirname}/${page}.png' },
        async () => {
          await vscode.commands.executeCommand('graphics-workbench.splitPdf.configure', vscode.Uri.file(sourcePath));
        },
      );

      assertShowExtensionError(showErrorMessage);
      assert.strictEqual(createWebviewPanel.called, false);
    });
  });

  test('encryptPdfの出力パス設定が.pngで終わる場合は、暗号化処理（withProgress）を開始せず、無効な拡張子のエラー通知を出す', async () => {
    await withPdfSource(async (sourcePath, sandbox) => {
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const withProgress = sandbox
        .stub(vscode.window, 'withProgress')
        .rejects(new Error('withProgress must not be called for an invalid output path.'));
      sandbox.stub(vscode.window, 'showInputBox').resolves('secret');

      await withWorkspaceSettings({ 'graphics-workbench.outputPath.encryptPdf': invalidPdfTemplate }, async () => {
        await vscode.commands.executeCommand('graphics-workbench.encryptPdf', vscode.Uri.file(sourcePath));
      });

      assertShowExtensionError(showErrorMessage);
      assert.ok(withProgress.notCalled);
    });
  });

  test('convertToPdf（SVG入力）の出力パス設定が.pngで終わる場合は、変換処理（withProgress）を開始せず、無効な拡張子のエラー通知を出す', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-pdf-extension-validation-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'source.svg');
      await copyFile(path.join(testInputDirectory, 'valid', 'svg', 'gradient-card.svg'), sourcePath);
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const withProgress = sandbox
        .stub(vscode.window, 'withProgress')
        .rejects(new Error('withProgress must not be called for an invalid output path.'));

      await withWorkspaceSettings({ 'graphics-workbench.outputPath.single.pdf': invalidPdfTemplate }, async () => {
        await vscode.commands.executeCommand('graphics-workbench.convertToPdf', vscode.Uri.file(sourcePath));
      });

      assertShowExtensionError(showErrorMessage);
      assert.ok(withProgress.notCalled);
    } finally {
      sandbox.restore();
    }
  });
});

async function withPdfSource(
  run: (sourcePath: string, sandbox: ReturnType<typeof createSandbox>) => Promise<void>,
): Promise<void> {
  const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
  const sandbox = createSandbox();
  await using temporaryDirectory = await mkdtempDisposable(
    path.join(workspaceFolder.uri.fsPath, 'gw-pdf-extension-validation-'),
  );

  try {
    const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
    await copyFile(path.join(operationPdfInputDirectory, 'multi-page-table.pdf'), sourcePath);
    await run(sourcePath, sandbox);
  } finally {
    sandbox.restore();
  }
}

function assertShowExtensionError(showErrorMessage: sinon.SinonStub): void {
  assert.ok(showErrorMessage.calledOnce, '無効な拡張子はエラー通知されるべき');
  assert.match(String(showErrorMessage.firstCall.args[0]), /invalid output extension/i);
}
