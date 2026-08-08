import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPdfInputDirectory, operationPngInputPath } from '../helpers/fixture_paths.js';
import { extensionIdentity } from '../../src/generated/extension_manifest.js';

const LEGACY_TO_PDF_COMMANDS = [
  'graphics-workbench.convertPngToPdf',
  'graphics-workbench.convertJpegToPdf',
  'graphics-workbench.convertWebpToPdf',
  'graphics-workbench.convertAvifToPdf',
  'graphics-workbench.convertSvgToPdf',
] as const;

suite('Extension activation smoke', () => {
  test('拡張機能をactivateすると代表commandが利用可能になる', async () => {
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
      'graphics-workbench.convertDrawioToPdf',
      'graphics-workbench.convertDrawioToPdfDirectly',
    ]) {
      assert.ok(commands.includes(command), `Expected command to be registered: ${command}`);
    }
    assert.ok(!commands.includes('graphics-workbench.cropPdf.manual'));

    for (const legacyCommand of LEGACY_TO_PDF_COMMANDS) {
      assert.ok(!commands.includes(legacyCommand), `Legacy command should not be registered: ${legacyCommand}`);
    }
  });

  test('PNGからPDFへの変換コマンドを実行してファイル変換できる', async () => {
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

      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(pdf.getPageCount(), 1);
    } finally {
      sandbox.restore();
    }
  });

  test('cropPdf.autoコマンドがworkspace内のPDFを受け付けてエラーにできる', async () => {
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
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await readFile(croppedPath));
      assert.strictEqual(pdf.getPageCount(), 2);
    } finally {
      sandbox.restore();
    }
  });

  test('splitPdf.allPagesコマンドがworkspace内のPDFをページごとに分割できる', async () => {
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

      const { PDFDocument } = await import('pdf-lib');
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
