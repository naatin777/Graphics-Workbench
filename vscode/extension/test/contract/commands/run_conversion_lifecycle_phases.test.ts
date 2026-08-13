// Test target:
// - runConversionLifecycleの「変換実行」「Undo記録」「成功通知」「Undo実行」phaseを分離し、
//   変換成功後のUI失敗（showInformationMessageのreject、Undo command呼び出し失敗）を
//   変換失敗として表示しないこと
//
// Mocked:
// - 通知API
// - undo actionを返すshowInformationMessage
//
// Not tested:
// - 実際の変換エラー時の失敗通知（既存の各command testが対象）

import assert from 'node:assert/strict';
import { access, mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { localeMap } from '../../../src/locale_map.js';
import { convertToRasterCommand } from '../../../src/commands/conversion/convert_to_raster.js';
import { liveCommandDependencies } from '../../support/helpers/command_dependencies.js';

import { requireValue } from '@graphics-workbench/core/testing';

const sourceJpegBase64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAANABEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbAL6KAA//2Q==';

suite('変換成功後の通知・Undo・Reveal実行の失敗を変換失敗として表示しない成功後処理の分離', () => {
  test('PNG変換が成功して出力ファイルsource.pngを作成した後、成功通知のshowInformationMessageが失敗しても、それを変換失敗としてエラー通知しない', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-lifecycle-phase-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'source.jpeg');
      await writeFile(sourcePath, Buffer.from(sourceJpegBase64, 'base64'));

      sandbox.stub(vscode.window, 'showInformationMessage').rejects(new Error('UI failed after input.'));
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await convertToRasterCommand([vscode.Uri.file(sourcePath)], liveCommandDependencies(), { target: 'png' });

      assert.ok(showErrorMessage.notCalled, '成功後のUI失敗を変換失敗として表示してはいけない');
      await access(path.join(temporaryDirectory.path, 'source.png'));

      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      sandbox.restore();
    }
  });

  test('変換成功後、成功通知でUndoボタンを選択した際にUndo commandの呼び出しが失敗しても、それを変換失敗としてエラー通知しない', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-lifecycle-phase-undo-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'source.jpeg');
      await writeFile(sourcePath, Buffer.from(sourceJpegBase64, 'base64'));

      sandbox.stub(vscode.window, 'showInformationMessage').resolves({
        title: localeMap('message.action.undo'),
      });
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').rejects(new Error('Undo UI failed.'));

      await convertToRasterCommand([vscode.Uri.file(sourcePath)], liveCommandDependencies(), { target: 'png' });

      assert.ok(showErrorMessage.notCalled, 'Undo実行失敗を変換失敗として表示してはいけない');
      await access(path.join(temporaryDirectory.path, 'source.png'));

      executeCommand.restore();
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      sandbox.restore();
    }
  });

  test('変換成功後の成功通知でReveal in Explorerを選択すると、生成された出力ファイルsource.pngのfile URIをrevealInExplorerで表示する', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-lifecycle-phase-reveal-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory.path, 'source.jpeg');
      await writeFile(sourcePath, Buffer.from(sourceJpegBase64, 'base64'));

      sandbox
        .stub(vscode.window, 'showInformationMessage')
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- showInformationMessage returns the clicked string item; sinon types it as MessageItem.
        .resolves(localeMap('message.action.revealInExplorer') as unknown as vscode.MessageItem);
      const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);

      await convertToRasterCommand([vscode.Uri.file(sourcePath)], liveCommandDependencies(), { target: 'png' });

      const revealCall = executeCommand.getCalls().find((call) => call.args[0] === 'revealInExplorer');
      assert.ok(revealCall, 'revealInExplorerが呼ばれること');
      const uri: vscode.Uri = revealCall.args[1];
      assert.strictEqual(uri.scheme, 'file');
      assert.strictEqual(uri.fsPath, path.join(temporaryDirectory.path, 'source.png'));
    } finally {
      sandbox.restore();
    }
  });
});
