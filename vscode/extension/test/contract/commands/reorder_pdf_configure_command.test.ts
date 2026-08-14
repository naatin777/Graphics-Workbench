// Test target:
// - Reorder ConfigureのApplyで、Webview protocolの検証を通過する重複page orderを送った場合、
//   operation側が拒否し、未処理のPromise rejectionにせずエラー通知とWebviewへの
//   errorメッセージ送信を行うこと
//
// Mocked:
// - Webview panel (createWebviewPanel)
// - 通知API
//
// Not tested:
// - 正常な並び替え処理本体

import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { requireValue, createPdfTestData } from '@graphics-workbench/core/testing';
import { createSandbox, match } from 'sinon';
import * as vscode from 'vscode';

import { stubWebviewPanel, waitFor } from '../../support/helpers/webview_panel.js';

suite('Reorder PDF ConfigureコマンドがWebviewから送られた重複orderをApply時に拒否してエラー通知する処理', () => {
  let sandbox: ReturnType<typeof createSandbox>;

  setup(() => {
    sandbox = createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('Webviewから重複ページ（1が2回）を含むorderをApplyするとホスト側のApply処理がそのorderを拒否し、エラー通知と拒否理由を含むerrorメッセージをWebviewへ送信する', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-reorder-configure-'),
    );

    const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
    await writeFile(
      sourcePath,
      await createPdfTestData({ pages: [{ mediaBox: [0, 0, 100, 100] }, { mediaBox: [0, 0, 100, 100] }] }),
    );

    const getPanel = stubWebviewPanel(sandbox);
    const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

    await vscode.commands.executeCommand('graphics-workbench.reorderPdf.configure', vscode.Uri.file(sourcePath));
    const panel = getPanel();

    panel.receiveMessage({ type: 'apply', payload: { order: [1, 1] } });
    await waitFor(() => showErrorMessage.calledOnce || panel.postMessage.calledOnce);

    assert.ok(showErrorMessage.calledOnce, '重複orderはoperation側が拒否しエラー通知されるべき');
    assert.ok(
      panel.postMessage.calledWith(
        match({ type: 'error', payload: match({ message: match(/appears more than once/i) }) }),
      ),
      'Webviewへoperationの拒否理由を送信すべき',
    );
  });
});
