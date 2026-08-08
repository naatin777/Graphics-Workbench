import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { requireValue } from '../helpers/required.js';
import { runCommandAndClearNotificationsUntilDone } from '../helpers/vscode_command.js';

suite('PDF圧縮コマンド', () => {
  test('qualityを選択してPDFを圧縮し、_compressed付きの出力を作成する', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-compress-pdf-'),
    );
    const sandbox = createSandbox();

    try {
      const sourcePath = path.join(workspacePath.path, 'source.pdf');
      const document = await PDFDocument.create();
      document.addPage([200, 150]);
      document.addPage([200, 150]);
      await writeFile(sourcePath, await document.save());

      sandbox.stub(vscode.window, 'showQuickPick').resolves({
        quality: 'ebook',
        label: 'eBook',
      } as vscode.QuickPickItem & { quality: 'ebook' });

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.compressPdf',
        vscode.Uri.file(sourcePath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const outputPath = path.join(workspacePath.path, 'source_compressed.pdf');
      const output = await PDFDocument.load(await readFile(outputPath));
      assert.ok(output.getPageCount() >= 1);
    } finally {
      sandbox.restore();
    }
  });
});
