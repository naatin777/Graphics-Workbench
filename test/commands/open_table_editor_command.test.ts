// Test target:
// - openTableEditorがWebview panelを開き、readyに応答して初期形式とlabelsを含むinitを送信する
// - insertで開いた時点のactive editorへ生成コードを挿入する
// - 対象editorが閉じられた場合に明示的なエラーにする
//
// Mocked:
// - Webview panel (createWebviewPanel)
// - 通知API
//
// Not tested:
// - Webviewアプリ自身の表示（webview/apps/table_editorのVitest）

import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox, match } from 'sinon';
import * as vscode from 'vscode';

import { requireValue } from '../helpers/required.js';
import { stubWebviewPanel, waitFor } from '../helpers/webview_panel.js';

suite('Open Table Editorコマンド', () => {
  test('active editorの文書言語から初期形式を決めてinitを送信する', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-table-editor-init-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'table.tex');
      await writeFile(sourcePath, '');
      await vscode.window.showTextDocument(vscode.Uri.file(sourcePath));

      const getPanel = stubWebviewPanel(sandbox);
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      await vscode.commands.executeCommand('graphics-workbench.openTableEditor');
      const panel = getPanel();

      assert.ok(panel.panel.webview.html.length > 0, 'Webview HTMLが設定されるべき');

      panel.receiveMessage({ type: 'ready' });
      await waitFor(() => panel.postMessage.calledOnce);

      const initMessage = panel.postMessage.firstCall.args[0];
      assert.strictEqual(initMessage.type, 'init');
      assert.strictEqual(initMessage.payload.format, 'latex');
      assert.ok(initMessage.payload.labels.header.title.length > 0);
      assert.ok(initMessage.payload.labels.table.headerToggle.length > 0);
    } finally {
      sandbox.restore();
    }
  });

  test('insertで開いた時点のactive editorへ生成コードを挿入する', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-table-editor-insert-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'table.tex');
      await writeFile(sourcePath, '');
      const editor = await vscode.window.showTextDocument(vscode.Uri.file(sourcePath));
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), editor.document.uri.toString());

      const getPanel = stubWebviewPanel(sandbox);
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      await vscode.commands.executeCommand('graphics-workbench.openTableEditor');
      const panel = getPanel();

      const code = '\\begin{tabular}{l}\nA & 1 \\\\\n\\end{tabular}';
      panel.receiveMessage({ type: 'insert', payload: { format: 'latex', code } });

      await waitFor(() => editor.document.getText().length > 0);

      const document = await vscode.workspace.openTextDocument(sourcePath);
      assert.strictEqual(document.getText(), code);
    } finally {
      sandbox.restore();
    }
  });

  test('対象editorが閉じられた場合は明示的なエラーを通知する', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-table-editor-closed-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'table.tex');
      await writeFile(sourcePath, '');
      await vscode.window.showTextDocument(vscode.Uri.file(sourcePath));

      const getPanel = stubWebviewPanel(sandbox);
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      await vscode.commands.executeCommand('graphics-workbench.openTableEditor');
      const panel = getPanel();

      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await waitFor(() => vscode.window.activeTextEditor === undefined);

      panel.receiveMessage({ type: 'insert', payload: { format: 'latex', code: '\\begin{tabular}{l}\\end{tabular}' } });

      await waitFor(() => showErrorMessage.calledOnce);
      assert.ok(
        showErrorMessage.calledWith(match(/closed/i)),
        '閉じられたeditorへのinsertは明示的なエラー通知であるべき',
      );
      assert.ok(
        panel.postMessage.calledWith(match({ type: 'error', payload: match({ message: match(/closed/i) }) })),
        'Webviewへerrorメッセージを送信すべき',
      );
    } finally {
      sandbox.restore();
    }
  });
});
