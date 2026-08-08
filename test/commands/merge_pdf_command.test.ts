import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtempDisposable, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';
import { createSandbox, match } from 'sinon';
import * as vscode from 'vscode';

import { localeMap } from '../../src/locale_map.js';
import { mergePdfConfigureCommand } from '../../src/commands/pdf/merge_pdf.js';

import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';
import { assertRenderedPdfPagesSimilar } from '../helpers/pdf_visual_assertions.js';
import { runCommandAndClearNotificationsUntilDone } from '../helpers/vscode_command.js';

const compiledTestDirectory = path.dirname(fileURLToPath(import.meta.url));
const firstFixturePath = path.join(operationPdfInputDirectory, 'multi-page-table.pdf');
const secondFixturePath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');
const longFixturePath = path.join(operationPdfInputDirectory, 'multi-page-mixed-content.pdf');

suite('PDF結合コマンド', () => {
  test('VS Codeに選択ファイル版のPDF結合コマンドが登録されており、旧ページ選択版のコマンドは登録されていない', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('graphics-workbench.mergePdf.selectedFiles'));
    assert.ok(!commands.includes('graphics-workbench.mergePdf.selectedPages'));
  });

  test('選択された2つのPDFを先頭から順に読み込み、それぞれの全ページを同じ順序で1つの出力PDFへ書き出し、2件の成功通知を出す', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-command-'),
    );

    try {
      const firstPdfPath = path.join(temporaryDirectory.path, 'q a.PDF');
      const secondPdfPath = path.join(temporaryDirectory.path, ' 薔薇🌹.pdf');
      const outputPath = path.join(temporaryDirectory.path, 'merged.pdf');
      const renderDirectory = path.join(temporaryDirectory.path, 'rendered');

      await copyFile(firstFixturePath, firstPdfPath);
      await copyFile(secondFixturePath, secondPdfPath);
      await mkdir(renderDirectory);

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));
      const showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.mergePdf.selectedFiles',
        vscode.Uri.file(firstPdfPath),
        [vscode.Uri.file(firstPdfPath), vscode.Uri.file(secondPdfPath)],
      );

      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const mergedPdf = await PDFDocument.load(await readFile(outputPath));
      const firstPdf = await PDFDocument.load(await readFile(firstPdfPath));
      const secondPdf = await PDFDocument.load(await readFile(secondPdfPath));
      const expectedPageSizes = [...firstPdf.getPages(), ...secondPdf.getPages()].map((page) => page.getSize());

      assert.strictEqual(mergedPdf.getPageCount(), expectedPageSizes.length);
      assert.deepStrictEqual(
        mergedPdf.getPages().map((page) => page.getSize()),
        expectedPageSizes,
      );
      assert.ok((await stat(outputPath)).size > 0);
      assert.ok(
        showInformationMessage.calledWith(localeMap('message.mergePdf.success').replace('{0}', '2'), match.any),
      );

      let outputPageNumber = 1;
      for (const [sourceIndex, sourcePath] of [firstPdfPath, secondPdfPath].entries()) {
        const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
        for (let sourcePageNumber = 1; sourcePageNumber <= sourceDocument.getPageCount(); sourcePageNumber += 1) {
          await assertRenderedPdfPagesSimilar({
            expectedPdfPath: sourcePath,
            expectedPageNumber: sourcePageNumber,
            actualPdfPath: outputPath,
            actualPageNumber: outputPageNumber,
            renderDirectory,
            renderPrefix: `merge-${sourceIndex + 1}-${sourcePageNumber}`,
          });
          outputPageNumber += 1;
        }
      }
    } finally {
      sandbox.restore();
    }
  });

  test('10ページ以上の長いPDFと2つ目のPDFを結合し、合計17ページを含む1つの出力PDFとして保存する', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-long-command-'),
    );

    try {
      const longPdfPath = path.join(temporaryDirectory.path, 'long-input.pdf');
      const secondPdfPath = path.join(temporaryDirectory.path, 'second-input.pdf');
      const outputPath = path.join(temporaryDirectory.path, 'merged.pdf');
      await copyFile(longFixturePath, longPdfPath);
      await copyFile(secondFixturePath, secondPdfPath);

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.mergePdf.selectedFiles',
        vscode.Uri.file(longPdfPath),
        [vscode.Uri.file(longPdfPath), vscode.Uri.file(secondPdfPath)],
      );

      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const mergedPdf = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(mergedPdf.getPageCount(), 17);
      assert.ok((await stat(outputPath)).size > 0);
    } finally {
      sandbox.restore();
    }
  });

  test('選択にworkspace外へ解決するsymlinkのPDFが含まれる場合はConfigureのWebviewを開かず、エラー通知を表示する', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-configure-'),
    );
    await using outsideDirectory = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-pdf-outside-'));

    try {
      const firstPdfPath = path.join(temporaryDirectory.path, 'first.pdf');
      const outsidePdfPath = path.join(outsideDirectory.path, 'second.pdf');
      const linkedDirectory = path.join(temporaryDirectory.path, 'linked');
      const linkedPdfPath = path.join(linkedDirectory, 'second.pdf');
      await copyFile(firstFixturePath, firstPdfPath);
      await copyFile(secondFixturePath, outsidePdfPath);
      await symlink(outsideDirectory.path, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');

      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      const createWebviewPanel = sandbox.stub(vscode.window, 'createWebviewPanel');

      await mergePdfConfigureCommand({ extensionUri: vscode.Uri.file(compiledTestDirectory) }, undefined, [
        vscode.Uri.file(firstPdfPath),
        vscode.Uri.file(linkedPdfPath),
      ]);

      assert.strictEqual(createWebviewPanel.called, false);
      assert.strictEqual(showErrorMessage.calledOnce, true);
    } finally {
      sandbox.restore();
    }
  });

  test('選択にPDF以外のファイル（.txt）が含まれる場合は保存ダイアログを表示せず結合を開始せず、エラー通知を出して出力ファイルも作成しない', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      `${path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-command-')}-`,
    );

    try {
      const firstPdfPath = path.join(temporaryDirectory.path, 'q a.pdf');
      const secondPdfPath = path.join(temporaryDirectory.path, ' 薔薇🌹.pdf');
      const textPath = path.join(temporaryDirectory.path, 'notes.txt');
      await copyFile(firstFixturePath, firstPdfPath);
      await copyFile(secondFixturePath, secondPdfPath);
      await writeFile(textPath, 'not a PDF');

      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.mergePdf.selectedFiles',
        vscode.Uri.file(firstPdfPath),
        [vscode.Uri.file(firstPdfPath), vscode.Uri.file(secondPdfPath), vscode.Uri.file(textPath)],
      );

      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.strictEqual(showSaveDialog.called, false);
      assert.strictEqual(showErrorMessage.calledOnce, true);
      await assert.rejects(access(path.join(temporaryDirectory.path, 'merged.pdf')));
    } finally {
      sandbox.restore();
    }
  });

  test('選択にfileスキームでないURI（untitled:）が含まれる場合は保存ダイアログを表示せず結合を開始せず、エラー通知を出す', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      `${path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-command-')}-`,
    );

    try {
      const firstPdfPath = path.join(temporaryDirectory.path, 'first.pdf');
      const secondPdfPath = path.join(temporaryDirectory.path, 'second.pdf');
      await copyFile(firstFixturePath, firstPdfPath);
      await copyFile(secondFixturePath, secondPdfPath);

      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.mergePdf.selectedFiles',
        vscode.Uri.file(firstPdfPath),
        [vscode.Uri.file(firstPdfPath), vscode.Uri.file(secondPdfPath), vscode.Uri.parse('untitled:notes.pdf')],
      );

      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.strictEqual(showSaveDialog.called, false);
      assert.strictEqual(showErrorMessage.calledOnce, true);
    } finally {
      sandbox.restore();
    }
  });

  test('選択がPDF1ファイルのみの場合は結合に必要な2ファイル以上を満たさないため、保存ダイアログを表示せずエラー通知を出す', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      `${path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-command-')}-`,
    );

    try {
      const pdfPath = path.join(temporaryDirectory.path, 'q a.pdf');
      await copyFile(firstFixturePath, pdfPath);

      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');
      const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.mergePdf.selectedFiles',
        vscode.Uri.file(pdfPath),
        [vscode.Uri.file(pdfPath)],
      );

      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.strictEqual(showSaveDialog.called, false);
      assert.strictEqual(showErrorMessage.calledOnce, true);
    } finally {
      sandbox.restore();
    }
  });

  test('出力先に既存PDFがあり上書き確認でOverwriteを選択した場合は、既存出力を結合結果の4ページPDFで置き換える', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      `${path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-command-')}-`,
    );

    try {
      const firstPdfPath = path.join(temporaryDirectory.path, 'q a.pdf');
      const secondPdfPath = path.join(temporaryDirectory.path, ' 薔薇🌹.pdf');
      const outputPath = path.join(temporaryDirectory.path, 'merged.pdf');
      await copyFile(firstFixturePath, firstPdfPath);
      await copyFile(secondFixturePath, secondPdfPath);
      await copyFile(firstFixturePath, outputPath);

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves({ title: localeMap('message.safeMode.overwrite') });
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.mergePdf.selectedFiles',
        vscode.Uri.file(firstPdfPath),
        [vscode.Uri.file(firstPdfPath), vscode.Uri.file(secondPdfPath)],
      );

      await runCommandAndClearNotificationsUntilDone(commandExecution);

      const mergedPdf = await PDFDocument.load(await readFile(outputPath));
      assert.strictEqual(mergedPdf.getPageCount(), 4);
      assert.ok((await stat(outputPath)).size > 0);
    } finally {
      sandbox.restore();
    }
  });

  test('結合対象に不正な内容のPDFが含まれ結合途中で失敗する場合は、既存の出力ファイルを元の内容のまま変更しない', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    const sandbox = createSandbox();
    await using temporaryDirectory = await mkdtempDisposable(
      `${path.join(workspaceFolder.uri.fsPath, 'gw-merge-pdf-command-')}-`,
    );

    try {
      const firstPdfPath = path.join(temporaryDirectory.path, 'q a.pdf');
      const brokenPdfPath = path.join(temporaryDirectory.path, 'broken.pdf');
      const outputPath = path.join(temporaryDirectory.path, 'merged.pdf');
      await copyFile(firstFixturePath, firstPdfPath);
      await writeFile(brokenPdfPath, 'not a PDF');
      await copyFile(firstFixturePath, outputPath);
      const originalOutputBytes = await readFile(outputPath);

      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.mergePdf.selectedFiles',
        vscode.Uri.file(firstPdfPath),
        [vscode.Uri.file(firstPdfPath), vscode.Uri.file(brokenPdfPath)],
      );

      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.deepStrictEqual(await readFile(outputPath), originalOutputBytes);
    } finally {
      sandbox.restore();
    }
  });
});
