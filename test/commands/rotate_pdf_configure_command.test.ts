// Test target:
// - Rotate ConfigureのApplyでoperationがrejectした場合に、未処理のPromise rejectionにせず
//   エラー通知とWebviewへのerrorメッセージ送信を行うこと
// - 失敗後もapply lockが解放され、再度Applyできること
//
// Mocked:
// - Webview panel (createWebviewPanel)
// - 通知API
//
// Not tested:
// - 正常な回転処理本体

import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox, match } from 'sinon';
import * as vscode from 'vscode';

import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';
import { stubWebviewPanel, waitFor } from '../helpers/webview_panel.js';

suite('Rotate PDF ConfigureコマンドのApplyエラー処理', () => {
  test('範囲外ページをApplyするとエラー通知され、Webviewへerrorメッセージが返る', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    const temporaryDirectory = await mkdtemp(
      path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-rotate-configure-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.pdf');
      await copyFile(path.join(operationPdfInputDirectory, 'multi-page-table.pdf'), sourcePath);

      const getPanel = stubWebviewPanel(sandbox);
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      await vscode.commands.executeCommand('graphics-workbench.rotatePdf.configure', vscode.Uri.file(sourcePath));
      const panel = getPanel();

      panel.receiveMessage({ type: 'apply', payload: { angle: 90, pageIndices: [99] } });
      await waitFor(() => showErrorMessage.calledOnce || panel.postMessage.calledOnce);

      assert.ok(showErrorMessage.calledOnce, 'Apply失敗はエラー通知されるべき');
      assert.ok(
        panel.postMessage.calledWith(match({ type: 'error', payload: match({ message: match(/out of range/i) }) })),
        'Webviewへerrorメッセージを送信すべき',
      );
    } finally {
      sandbox.restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('Apply失敗後もapply lockが解放され、再度Applyできる', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    const temporaryDirectory = await mkdtemp(
      path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-rotate-configure-retry-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.pdf');
      await copyFile(path.join(operationPdfInputDirectory, 'multi-page-table.pdf'), sourcePath);

      const getPanel = stubWebviewPanel(sandbox);
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      await vscode.commands.executeCommand('graphics-workbench.rotatePdf.configure', vscode.Uri.file(sourcePath));
      const panel = getPanel();

      panel.receiveMessage({ type: 'apply', payload: { angle: 90, pageIndices: [99] } });
      await waitFor(() => showErrorMessage.calledOnce);

      panel.receiveMessage({ type: 'apply', payload: { angle: 90, pageIndices: [98] } });
      await waitFor(() => showErrorMessage.calledTwice);

      assert.ok(showErrorMessage.calledTwice, '2回目のApplyも処理されるべき');
    } finally {
      sandbox.restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
