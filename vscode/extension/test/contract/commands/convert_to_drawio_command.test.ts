import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { testInputDirectory } from '../../support/helpers/fixture_paths.js';
import { requireValue } from '@graphics-workbench/core/testing';
import { runCommandAndClearNotificationsUntilDone } from '../../support/helpers/vscode_command.js';

suite('Draw.ioへ変換コマンド', () => {
  test('PNG入力を.dioファイルへ変換し、出力内容にmxfileまたはmxGraphModelが含まれる', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-to-drawio-command-'),
    );

    const sourcePath = path.join(workspacePath.path, 'source.png');
    await copyFile(path.join(testInputDirectory, 'valid', 'png', 'checker-mosaic.png'), sourcePath);

    const commandExecution = vscode.commands.executeCommand(
      'graphics-workbench.convertToDrawio',
      vscode.Uri.file(sourcePath),
    );
    await runCommandAndClearNotificationsUntilDone(commandExecution);

    const outputPath = path.join(workspacePath.path, 'source.dio');
    await access(outputPath);
    assert.match(await readFile(outputPath, 'utf8'), /<mxfile|mxGraphModel/u);
  });
});
