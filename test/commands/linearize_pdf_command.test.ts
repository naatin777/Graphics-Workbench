import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { requireValue } from '../helpers/required.js';
import { runCommandAndClearNotificationsUntilDone } from '../helpers/vscode_command.js';

suite('PDFリニアライズコマンド', () => {
  test('PDFをリニアライズし、-linearized付きの出力を作成する', async () => {
    const workspacePath = await mkdtemp(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'graphics-workbench-linearize-pdf-'),
    );

    try {
      const sourcePath = path.join(workspacePath, 'source.pdf');
      const document = await PDFDocument.create();
      document.addPage([200, 150]);
      document.addPage([200, 150]);
      await writeFile(sourcePath, await document.save());

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.linearizePdf',
        vscode.Uri.file(sourcePath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const outputPath = path.join(workspacePath, 'source-linearized.pdf');
      const output = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(output.getPageCount(), 2);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
