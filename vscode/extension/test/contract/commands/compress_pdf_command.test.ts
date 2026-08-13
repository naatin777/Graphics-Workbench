import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument, requireValue } from '@graphics-workbench/core/testing';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

suite('PDF圧縮コマンド', () => {
  const sandbox = createSandbox();

  teardown(() => {
    sandbox.restore();
  });

  test('2ページのPDF入力をCompress PDFで処理すると、ソースと同名の_compressed.pdfを出力し、2ページPDFとして読み込める', async () => {
    const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    const showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
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
    await commandExecution;
    assert.deepStrictEqual(showErrorMessage.args, []);
    assert.strictEqual(showInformationMessage.firstCall?.args.length, 3);

    const outputPath = path.join(workspacePath.path, 'source_compressed.pdf');
    const output = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(output.getPageCount(), 2);
  });
});
