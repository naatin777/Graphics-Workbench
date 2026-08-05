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
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { localeMap } from '../../src/locale_map.js';
import { convertToPngCommand } from '../../src/commands/conversion/convert_to_png.js';

import { requireValue } from '../helpers/required.js';

const sourceJpegBase64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAANABEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbAL6KAA//2Q==';

suite('runConversionLifecycleの成功後phase分離', () => {
  test('変換成功後のshowInformationMessage失敗は変換失敗として表示しない', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    const temporaryDirectory = await mkdtemp(
      path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-lifecycle-phase-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.jpeg');
      await writeFile(sourcePath, Buffer.from(sourceJpegBase64, 'base64'));

      sandbox.stub(vscode.window, 'showInformationMessage').rejects(new Error('UI failed after conversion.'));
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await convertToPngCommand(vscode.Uri.file(sourcePath));

      assert.ok(showErrorMessage.notCalled, '成功後のUI失敗を変換失敗として表示してはいけない');
      await access(path.join(temporaryDirectory, 'source.png'));

      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      sandbox.restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('変換成功後のUndo command呼び出し失敗も変換失敗として表示しない', async () => {
    const workspaceFolder = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sandbox = createSandbox();
    const temporaryDirectory = await mkdtemp(
      path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-lifecycle-phase-undo-'),
    );

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.jpeg');
      await writeFile(sourcePath, Buffer.from(sourceJpegBase64, 'base64'));

      sandbox.stub(vscode.window, 'showInformationMessage').resolves({
        title: localeMap('message.action.undo'),
      });
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').rejects(new Error('Undo UI failed.'));

      await convertToPngCommand(vscode.Uri.file(sourcePath));

      assert.ok(showErrorMessage.notCalled, 'Undo実行失敗を変換失敗として表示してはいけない');
      await access(path.join(temporaryDirectory, 'source.png'));

      executeCommand.restore();
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      sandbox.restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
