import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPdfInputDirectory, operationPngInputPath } from '../support/helpers/fixture_paths.js';
import { extensionIdentity } from '../../src/generated/extension_manifest.js';

suite('拡張機能のactivateとworkspace内ファイルへの変換コマンド実行', () => {
  test('拡張機能をactivateするとcropPdf.autoやsplitPdf.allPagesなどの代表commandが登録される', async () => {
    const extension = vscode.extensions.getExtension(extensionIdentity.id);

    assert.ok(extension);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'graphics-workbench.cropPdf.auto',
      'graphics-workbench.cropPdf.configure',
      'graphics-workbench.splitPdf.allPages',
      'graphics-workbench.mergePdf.configure',
      'graphics-workbench.splitPdf.configure',
      'graphics-workbench.convertToPdf',
      'graphics-workbench.convertDrawioToPagePdfs',
      'graphics-workbench.convertDrawioToSinglePdf',
      'graphics-workbench.combineImagesToPdf',
      'graphics-workbench.quickCombineImagesToPdf',
    ]) {
      assert.ok(commands.includes(command), `Expected command to be registered: ${command}`);
    }
  });

  test('workspace内のPNGにconvertToPdfコマンドを実行すると、同じディレクトリへ1ページのPDFが生成される', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-extension-test-'),
    );

    try {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const sourcePath = path.join(temporaryDirectory.path, 'source.png');
      const outputPath = path.join(temporaryDirectory.path, 'source.pdf');
      await copyFile(operationPngInputPath, sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.convertToPdf', vscode.Uri.file(sourcePath));

      const { PDFDocument } = await import('@graphics-workbench/core/testing');
      const pdf = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(pdf.getPageCount(), 1);
    } finally {
      sandbox.restore();
    }
  });

  test('workspace内の2ページPDFにcropPdf.autoコマンドを実行すると、margin 0で自動クロップした2ページのdocument-crop.pdfが生成される', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspaceFolder.uri.fsPath, 'gw-crop-auto-'));

    try {
      const selectedMargin = { label: '0 pt', description: '', margin: 0 };
      sandbox.stub(vscode.window, 'showQuickPick').resolves(selectedMargin);
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const sourcePath = path.join(temporaryDirectory.path, 'document.pdf');
      await copyFile(path.join(operationPdfInputDirectory, 'multi-page-table.pdf'), sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.cropPdf.auto', vscode.Uri.file(sourcePath));

      const croppedPath = path.join(temporaryDirectory.path, 'document-crop.pdf');
      const { PDFDocument } = await import('@graphics-workbench/core/testing');
      const pdf = await PDFDocument.load(await readFile(croppedPath));
      assert.strictEqual(pdf.getPageCount(), 2);
    } finally {
      sandbox.restore();
    }
  });

  test('workspace内の2ページPDFにsplitPdf.allPagesコマンドを実行すると、split-testディレクトリ配下へページごとに1ページのPDF（1.pdfと2.pdf）が生成される', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspaceFolder.uri.fsPath, 'gw-split-all-'));

    try {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      const sourcePath = path.join(temporaryDirectory.path, 'split-test.pdf');
      await copyFile(path.join(operationPdfInputDirectory, 'multi-page-table.pdf'), sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.splitPdf.allPages', vscode.Uri.file(sourcePath));

      const { PDFDocument } = await import('@graphics-workbench/core/testing');
      const splitOutputDir = path.join(temporaryDirectory.path, 'split-test');
      for (const page of [1, 2]) {
        const pagePath = path.join(splitOutputDir, `${page}.pdf`);
        const pdf = await PDFDocument.load(await readFile(pagePath));
        assert.strictEqual(pdf.getPageCount(), 1);
      }
    } finally {
      sandbox.restore();
    }
  });
});
