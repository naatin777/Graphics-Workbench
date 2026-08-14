import { createPdfTestData, readPdfPages } from '@graphics-workbench/core/testing';
import assert from 'node:assert/strict';
import { access, mkdtempDisposable, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import {
  recordConversionForUndo,
  undoLastConversionCommand,
} from '../../../src/commands/lifecycle/undo_last_conversion.js';
import { LatexPasteEditProvider } from '../../../src/edit_provider/latex_paste_edit_provider.js';
import { operationPngInputPath } from '../../support/helpers/testdata_paths.js';
import { liveCommandDependencies } from '../../support/helpers/command_dependencies.js';

suite('LaTeXクリップボード画像挿入', () => {
  let sandbox: ReturnType<typeof createSandbox>;

  setup(() => {
    sandbox = createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test("clipboardのPNGを'画像形式で貼り付け'選択と入力名'edited'でedited.pngとして保存し、\\includegraphics{edited.png}と\\caption{edited}を含むfigure snippetを返す", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    await using directory = await mkdtempDisposable(path.join(workspaceFolder.uri.fsPath, 'gw-latex-paste-'));

    const documentUri = vscode.Uri.file(path.join(directory.path, 'main.tex'));
    await vscode.workspace.fs.writeFile(documentUri, Buffer.from('', 'utf8'));
    sandbox.stub(vscode.window, 'showQuickPick').resolves({
      label: '画像形式で貼り付け',
      detail: '画像をfigure環境に配置',
      description: '(標準)',
      pasteKind: 'image',
    } as vscode.QuickPickItem & { pasteKind: 'image' });
    const showInputBox = sandbox.stub(vscode.window, 'showInputBox').resolves(path.join(directory.path, 'edited'));

    const document = await vscode.workspace.openTextDocument(documentUri);
    const provider = new LatexPasteEditProvider();
    const tokenSource = new vscode.CancellationTokenSource();

    try {
      const edits = await provider.provideDocumentPasteEdits(
        document,
        [new vscode.Range(0, 0, 0, 0)],
        pngDataTransfer(),
        pasteContext(),
        tokenSource.token,
      );

      assert.ok(edits);
      assert.strictEqual(edits.length, 1);
      const [edit] = edits;
      assert.ok(edit);
      assert.ok(showInputBox.calledOnce);
      assert.ok(edit.insertText instanceof vscode.SnippetString);
      const snippet = normalizeSnippetValue(edit.insertText.value);
      assert.ok(snippet.includes('\\includegraphics{edited.png}'));
      assert.ok(snippet.includes('\\caption{edited}'));
      assert.ok(await readFile(path.join(directory.path, 'edited.png')));
    } finally {
      tokenSource.dispose();
    }
  });

  test("Undo記録(backup保存)が'backup unavailable'で失敗しても、保存済みのpasted.pngとPaste editを維持し、警告を1回表示し、一時保存用の.graphics-workbench/clipboard-pasteディレクトリを作らない", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    await using directory = await mkdtempDisposable(path.join(workspaceFolder.uri.fsPath, 'gw-latex-paste-undo-'));

    const documentUri = vscode.Uri.file(path.join(directory.path, 'main.tex'));
    await vscode.workspace.fs.writeFile(documentUri, Buffer.from('', 'utf8'));
    sandbox.stub(vscode.window, 'showQuickPick').resolves({
      label: '画像形式で貼り付け',
      detail: '画像をfigure環境に配置',
      description: '(標準)',
      pasteKind: 'image',
    } as vscode.QuickPickItem & { pasteKind: 'image' });
    sandbox.stub(vscode.window, 'showInputBox').resolves(path.join(directory.path, 'pasted'));
    const showWarningMessage = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    const document = await vscode.workspace.openTextDocument(documentUri);
    const provider = new LatexPasteEditProvider({
      recordConversionForUndo: async () => {
        throw new Error('backup unavailable');
      },
    });
    const tokenSource = new vscode.CancellationTokenSource();

    try {
      const edits = await provider.provideDocumentPasteEdits(
        document,
        [new vscode.Range(0, 0, 0, 0)],
        pngDataTransfer(),
        pasteContext(),
        tokenSource.token,
      );

      assert.ok(edits);
      assert.strictEqual(edits.length, 1);
      assert.ok(await readFile(path.join(directory.path, 'pasted.png')));
      const [edit] = edits;
      assert.ok(edit);
      assert.ok(edit.insertText instanceof vscode.SnippetString);
      assert.ok(normalizeSnippetValue(edit.insertText.value).includes('pasted.png'));
      assert.ok(showWarningMessage.calledOnce);
      await assert.rejects(access(path.join(directory.path, '.graphics-workbench', 'clipboard-paste')));
    } finally {
      tokenSource.dispose();
    }
  });

  test("clipboardのPNGを'PDF形式で貼り付け'選択で1ページのpasted.pdfとして保存し、既存PDFのbackupを作ってundoで復元し、競合時に両方保持する選択肢を選んだ場合はpasted-1.pdfを生成してundoで削除する", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    await using directory = await mkdtempDisposable(path.join(workspaceFolder.uri.fsPath, 'gw-latex-paste-pdf-'));

    const documentUri = vscode.Uri.file(path.join(directory.path, 'main.tex'));
    await vscode.workspace.fs.writeFile(documentUri, Buffer.from('', 'utf8'));
    const existingImagePath = path.join(directory.path, 'pasted.png');
    const existingPdfPath = path.join(directory.path, 'pasted.pdf');
    await writeFile(existingImagePath, 'existing clipboard image');
    const existingPdf = await createPdfBytes('old PDF');
    await writeFile(existingPdfPath, existingPdf);
    sandbox.stub(vscode.window, 'showQuickPick').resolves({
      label: 'PDF形式で貼り付け',
      detail: 'PDFをfigure環境に配置',
      description: '(標準)',
      pasteKind: 'pdf',
    } as vscode.QuickPickItem & { pasteKind: 'pdf' });
    sandbox.stub(vscode.window, 'showInputBox').resolves(path.join(directory.path, 'pasted'));
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

    const document = await vscode.workspace.openTextDocument(documentUri);
    const outputLines: string[] = [];
    let conversionRoot: string | undefined;
    const provider = new LatexPasteEditProvider({
      resolveOutputConflicts: async () => 'overwrite',
      outputChannel: { appendLine: (line) => outputLines.push(line) },
      recordConversionForUndo: async (outputs) => {
        assert.ok(outputs[0]?.previousFilePath);
        conversionRoot = outputs[0]?.stagingRootPath;
        const id = await recordConversionForUndo(outputs, {
          appendLine: (line) => outputLines.push(line),
        });
        await assert.doesNotReject(access(outputs[0]?.previousFilePath ?? ''));
        return id;
      },
    });
    const tokenSource = new vscode.CancellationTokenSource();

    try {
      const edits = await provider.provideDocumentPasteEdits(
        document,
        [new vscode.Range(0, 0, 0, 0)],
        pngDataTransfer(),
        pasteContext(),
        tokenSource.token,
      );

      assert.ok(edits);
      assert.strictEqual(edits.length, 1);
      const [edit] = edits;
      assert.ok(edit);
      assert.ok(edit.insertText instanceof vscode.SnippetString);
      const snippet = normalizeSnippetValue(edit.insertText.value);
      assert.ok(snippet.includes('\\includegraphics{pasted.pdf}'));
      const pdfPages = await readPdfPages(await readFile(path.join(directory.path, 'pasted.pdf')));
      assert.strictEqual(pdfPages.length, 1);
      assert.strictEqual(await readFile(existingImagePath, 'utf8'), 'existing clipboard image');
      assert.notDeepStrictEqual(await readFile(existingPdfPath), existingPdf);

      assert.ok(conversionRoot);
      const backupPaths = await findFiles(conversionRoot, (filePath) => filePath.endsWith('.previous'));
      assert.strictEqual(backupPaths.length, 1, outputLines.join('\n'));
      assert.deepStrictEqual(await readFile(backupPaths[0] ?? ''), existingPdf);
      await assert.rejects(access(stagedRootFromLines(outputLines)));

      await undoLastConversionCommand(undefined, liveCommandDependencies());
      assert.deepStrictEqual(await readFile(existingPdfPath), existingPdf);
      await assert.rejects(access(conversionRoot));

      const keepBothProvider = new LatexPasteEditProvider({
        resolveOutputConflicts: async () => 'keep-both',
        outputChannel: {
          appendLine: (line) => outputLines.push(`keep-both: ${line}`),
        },
      });
      const keepBothEdits = await keepBothProvider.provideDocumentPasteEdits(
        document,
        [new vscode.Range(0, 0, 0, 0)],
        pngDataTransfer(),
        pasteContext(),
        tokenSource.token,
      );
      assert.ok(keepBothEdits);
      assert.ok(await readFile(path.join(directory.path, 'pasted-1.pdf')));
      await assert.rejects(access(stagedRootFromLines(outputLines, 'keep-both: ')));
      await undoLastConversionCommand(undefined, liveCommandDependencies());
      await assert.rejects(access(path.join(directory.path, 'pasted-1.pdf')));
      assert.deepStrictEqual(await readFile(existingPdfPath), existingPdf);
    } finally {
      tokenSource.dispose();
    }
  });

  test('既存のpasted.pngがある状態で競合時に両方保持する選択肢を選んだ場合、既存ファイルを保持したままpasted-1.pngを生成し、snippetにpasted-1.pngを参照させる', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    await using directory = await mkdtempDisposable(path.join(workspaceFolder.uri.fsPath, 'gw-latex-paste-conflict-'));

    const documentUri = vscode.Uri.file(path.join(directory.path, 'main.tex'));
    const existingImagePath = path.join(directory.path, 'pasted.png');
    await vscode.workspace.fs.writeFile(documentUri, Buffer.from('', 'utf8'));
    await writeFile(existingImagePath, 'existing clipboard image');
    sandbox.stub(vscode.window, 'showQuickPick').resolves({
      label: '画像形式で貼り付け',
      detail: '画像をfigure環境に配置',
      description: '(標準)',
      pasteKind: 'image',
    } as vscode.QuickPickItem & { pasteKind: 'image' });
    sandbox.stub(vscode.window, 'showInputBox').resolves(path.join(directory.path, 'pasted'));
    const document = await vscode.workspace.openTextDocument(documentUri);
    const provider = new LatexPasteEditProvider({
      resolveOutputConflicts: async () => 'keep-both',
    });
    const tokenSource = new vscode.CancellationTokenSource();

    try {
      const edits = await provider.provideDocumentPasteEdits(
        document,
        [new vscode.Range(0, 0, 0, 0)],
        pngDataTransfer(),
        pasteContext(),
        tokenSource.token,
      );

      assert.ok(edits);
      assert.strictEqual(await readFile(existingImagePath, 'utf8'), 'existing clipboard image');
      assert.ok(await readFile(path.join(directory.path, 'pasted-1.png')));
      const [edit] = edits;
      assert.ok(edit);
      assert.ok(edit.insertText instanceof vscode.SnippetString);
      assert.ok(normalizeSnippetValue(edit.insertText.value).includes('pasted-1.png'));
    } finally {
      tokenSource.dispose();
    }
  });

  test('貼り付け処理開始前にキャンセル済みtokenが渡された場合は、Paste editを返さず(undefined)、showQuickPickも呼ばず、出力pasted.pngも作成しない', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    await using directory = await mkdtempDisposable(path.join(workspaceFolder.uri.fsPath, 'gw-latex-paste-cancel-'));
    const tokenSource = new vscode.CancellationTokenSource();

    const documentUri = vscode.Uri.file(path.join(directory.path, 'main.tex'));
    await vscode.workspace.fs.writeFile(documentUri, Buffer.from('', 'utf8'));
    const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
    sandbox.stub(vscode.window, 'showInputBox').resolves(path.join(directory.path, 'pasted'));
    tokenSource.cancel();

    const document = await vscode.workspace.openTextDocument(documentUri);
    const provider = new LatexPasteEditProvider();
    const edits = await provider.provideDocumentPasteEdits(
      document,
      [new vscode.Range(0, 0, 0, 0)],
      pngDataTransfer(),
      pasteContext(),
      tokenSource.token,
    );

    assert.strictEqual(edits, undefined);
    assert.ok(showQuickPick.notCalled);
    await assert.rejects(access(path.join(directory.path, 'pasted.png')));
  });

  test("競合解決処理中にcancelされた場合は、既存のpasted.pngを変更せず、一時保存用の.graphics-workbench/clipboard-pasteディレクトリを作らず、'cancellation requested'を出力チャンネルに記録してundefinedを返す", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);

    await using directory = await mkdtempDisposable(
      path.join(workspaceFolder.uri.fsPath, 'gw-latex-paste-conflict-cancel-'),
    );
    const tokenSource = new vscode.CancellationTokenSource();
    const lines: string[] = [];

    const documentUri = vscode.Uri.file(path.join(directory.path, 'main.tex'));
    const outputPath = path.join(directory.path, 'pasted.png');
    await vscode.workspace.fs.writeFile(documentUri, Buffer.from('', 'utf8'));
    await writeFile(outputPath, 'existing clipboard image');
    sandbox.stub(vscode.window, 'showQuickPick').resolves({
      label: '画像形式で貼り付け',
      detail: '画像をfigure環境に配置',
      description: '(標準)',
      pasteKind: 'image',
    } as vscode.QuickPickItem & { pasteKind: 'image' });
    sandbox.stub(vscode.window, 'showInputBox').resolves(path.join(directory.path, 'pasted'));

    const document = await vscode.workspace.openTextDocument(documentUri);
    const provider = new LatexPasteEditProvider({
      resolveOutputConflicts: async () => {
        tokenSource.cancel();
        return 'overwrite';
      },
      outputChannel: { appendLine: (line) => lines.push(line) },
    });
    const edits = await provider.provideDocumentPasteEdits(
      document,
      [new vscode.Range(0, 0, 0, 0)],
      pngDataTransfer(),
      pasteContext(),
      tokenSource.token,
    );

    assert.strictEqual(edits, undefined);
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing clipboard image');
    await assert.rejects(access(path.join(directory.path, '.graphics-workbench')));
    assert.ok(lines.some((line) => line.includes('cancellation requested')));
  });
});

function pngDataTransfer(): vscode.DataTransfer {
  const item = new vscode.DataTransferItem(undefined);
  item.asFile = () => ({
    name: 'test.png',
    async data() {
      return readFile(operationPngInputPath);
    },
  });
  const dataTransfer = new vscode.DataTransfer();
  dataTransfer.set('image/png', item);
  return dataTransfer;
}

function pasteContext(): vscode.DocumentPasteEditContext {
  return {
    only: undefined,
    triggerKind: vscode.DocumentPasteTriggerKind.Automatic,
  };
}

function normalizeSnippetValue(value: string): string {
  return value.replaceAll('\\\\', '\\').replaceAll(/\\([{}])/g, '$1');
}

async function createPdfBytes(_text: string): Promise<Buffer> {
  // Content text is not verified by these tests; a blank page is sufficient.
  return Buffer.from(await createPdfTestData({ pages: [{ mediaBox: [0, 0, 200, 100] }] }));
}

async function findFiles(rootPath: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findFiles(entryPath, predicate)));
      } else if (predicate(entryPath)) {
        files.push(entryPath);
      }
    }

    return files;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function stagedRootFromLines(lines: readonly string[], prefix = ''): string {
  const marker = `${prefix}[clipboard-paste] staged input: `;
  const line = lines.find((value) => value.startsWith(marker));

  assert.ok(line);
  return path.dirname(line.slice(marker.length));
}
