import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPdfInputDirectory, operationPngInputPath } from '../helpers/fixture_paths.js';

suite('拡張機能の基本動作', () => {
  test('拡張機能が登録されている', () => {
    const extension = vscode.extensions.getExtension('naatin777.graphics-workbench');

    assert.ok(extension);
  });

  test('拡張機能をactivateできる', async () => {
    const extension = vscode.extensions.getExtension('naatin777.graphics-workbench');

    assert.ok(extension);

    await extension.activate();

    assert.strictEqual(extension.isActive, true);
  });

  test('自動cropコマンドが登録されている', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('graphics-workbench.cropPdf.auto'));
  });

  test('configure cropコマンドが登録されている', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('graphics-workbench.cropPdf.configure'));
    assert.ok(!commands.includes('graphics-workbench.cropPdf.manual'));
  });

  test('全ページ分割コマンドが登録されている', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('graphics-workbench.splitPdf.allPages'));
  });

  test('PDF結合・分割のconfigureコマンドが登録されている', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('graphics-workbench.mergePdf.configure'));
    assert.ok(commands.includes('graphics-workbench.splitPdf.configure'));
  });

  test('PNGからPDFへの変換コマンドが登録されている', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('graphics-workbench.convertPngToPdf'));
  });

  test('Draw.io PDF変換コマンドが登録されている', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('graphics-workbench.convertDrawioToPdf'));
    assert.ok(commands.includes('graphics-workbench.convertDrawioToPdfDirectly'));
  });

  test('PNGからPDFへの変換コマンドを実行してファイル変換できる', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    const temporaryDirectory = await mkdtemp(
      path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-extension-test-'),
    );

    try {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const sourcePath = path.join(temporaryDirectory, 'source.png');
      const outputPath = path.join(temporaryDirectory, 'source.pdf');
      await copyFile(operationPngInputPath, sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.convertPngToPdf', vscode.Uri.file(sourcePath));

      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(pdf.getPageCount(), 1);
    } finally {
      sandbox.restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('cropPdf.autoコマンドがworkspace内のPDFを受け付けてエラーにできる', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-crop-auto-'));

    try {
      const selectedMargin = { label: '0 pt', description: '', margin: 0 };
      sandbox.stub(vscode.window, 'showQuickPick').resolves(selectedMargin);
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const sourcePath = path.join(temporaryDirectory, 'document.pdf');
      await copyFile(path.join(operationPdfInputDirectory, 'multi-page-table.pdf'), sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.cropPdf.auto', vscode.Uri.file(sourcePath));

      const croppedPath = path.join(temporaryDirectory, 'document-crop.pdf');
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await readFile(croppedPath));
      assert.strictEqual(pdf.getPageCount(), 2);
    } finally {
      sandbox.restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('splitPdf.allPagesコマンドがworkspace内のPDFをページごとに分割できる', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-split-all-'));

    try {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      const sourcePath = path.join(temporaryDirectory, 'split-test.pdf');
      await copyFile(path.join(operationPdfInputDirectory, 'multi-page-table.pdf'), sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.splitPdf.allPages', vscode.Uri.file(sourcePath));

      const { PDFDocument } = await import('pdf-lib');
      const splitOutputDir = path.join(temporaryDirectory, 'split-test');
      for (const page of [1, 2]) {
        const pagePath = path.join(splitOutputDir, `${page}.pdf`);
        const pdf = await PDFDocument.load(await readFile(pagePath));
        assert.strictEqual(pdf.getPageCount(), 1);
      }
    } finally {
      sandbox.restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
