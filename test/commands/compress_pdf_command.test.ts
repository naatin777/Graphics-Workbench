import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from '../helpers/pdf_document.js';
import * as vscode from 'vscode';

import { requireValue } from '../helpers/required.js';
import { runCommandAndClearNotificationsUntilDone } from '../helpers/vscode_command.js';

suite('PDF圧縮コマンド', () => {
  test('2ページのPDF入力をCompress PDFで処理すると、ソースと同名の_compressed.pdfを出力し、2ページPDFとして読み込める', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-compress-pdf-'),
    );
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const document = await PDFDocument.create();
    document.addPage([200, 150]);
    document.addPage([200, 150]);
    await writeFile(sourcePath, await document.save());

    const commandExecution = vscode.commands.executeCommand(
      'graphics-workbench.compressPdf',
      vscode.Uri.file(sourcePath),
    );
    await runCommandAndClearNotificationsUntilDone(commandExecution);

    const outputPath = path.join(workspacePath.path, 'source_compressed.pdf');
    const output = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(output.getPageCount(), 2);
  });
});
