import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { CONVERT_TO_DRAWIO_COMMAND } from '../../src/commands/command_ids.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';
import { runCommandAndClearNotificationsUntilDone } from '../helpers/vscode_command.js';

suite('Draw.ioへ変換コマンド', () => {
  test('PNGを.dioファイルへ変換する', async () => {
    const workspacePath = await mkdtemp(
      path.join(
        requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath,
        'graphics-workbench-to-drawio-command-',
      ),
    );

    try {
      const sourcePath = path.join(workspacePath, 'source.png');
      await copyFile(path.join(testInputDirectory, 'valid', 'png', 'checker-mosaic.png'), sourcePath);

      const commandExecution = vscode.commands.executeCommand(CONVERT_TO_DRAWIO_COMMAND, vscode.Uri.file(sourcePath));
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const outputPath = path.join(workspacePath, 'source.dio');
      await access(outputPath);
      assert.match(await readFile(outputPath, 'utf8'), /<mxfile|mxGraphModel/u);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
