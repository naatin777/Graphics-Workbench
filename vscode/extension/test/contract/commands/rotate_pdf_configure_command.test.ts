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
import { copyFile, mkdtempDisposable } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox, match } from 'sinon';
import * as vscode from 'vscode';

import { operationPdfInputDirectory } from '../../support/helpers/fixture_paths.js';
import { requireValue } from '@graphics-workbench/core/testing';
import { stubWebviewPanel, waitFor } from '../../support/helpers/webview_panel.js';

suite('Rotate PDF ConfigureコマンドがWebviewから送られたApplyを拒否してエラー通知する処理', () => {
  test('ページ総数を超えるページ番号99への回転Applyを送るとホスト側のApply処理が範囲外として拒否し、エラー通知とerrorメッセージをWebviewへ送信する', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-rotate-configure-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
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
    }
  });

  test('範囲外のApplyが失敗した後もApply中の多重実行ガードが解放されており、続けて送った2回目のApplyも処理され再びエラー通知が発生する', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-rotate-configure-retry-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
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
    }
  });
});
