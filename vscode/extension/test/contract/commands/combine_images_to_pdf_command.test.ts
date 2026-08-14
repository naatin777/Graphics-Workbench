import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, mkdtempDisposable, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import {
  type CombinePreviewItem,
  previewCombineInputs,
} from '../../../src/commands/conversion/combine_images_to_pdf.js';
import { userMessage } from '../../../src/commands/shared/user_messages.js';

import { operationPngInputPath } from '../../support/helpers/testdata_paths.js';
import { runCommandAndClearNotificationsUntilDone } from '../../support/helpers/vscode_command.js';
import { requireValue } from '@graphics-workbench/core/testing';
import { withWorkspaceSettings } from '../../support/helpers/workspace_settings.js';

const VALID_PNG = operationPngInputPath;

suite('画像を1つのPDFへ結合するコマンド', () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessage: sinon.SinonStub;
  let showInformationMessage: sinon.SinonStub;
  let createQuickPick: sinon.SinonStub;

  setup(() => {
    sandbox = createSandbox();
    showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    createQuickPick = sandbox
      .stub(vscode.window, 'createQuickPick')
      .callsFake(() => createFakeQuickPick((pick) => pick.accept()));
  });

  teardown(() => {
    sandbox.restore();
  });

  test('単一の入力だけでは変換を開始せず、2件以上必要であることを示すエラーメッセージを表示する', async () => {
    await using outsideDirectory = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-command-'));

    const sourcePath = path.join(outsideDirectory.path, 'outside.png');
    await copyFile(VALID_PNG, sourcePath);

    await vscode.commands.executeCommand('graphics-workbench.combineImagesToPdf', vscode.Uri.file(sourcePath));

    assert.ok(showErrorMessage.calledOnce);
    assert.match(String(showErrorMessage.firstCall.args[0]), /at least two/);
  });

  test('2つの入力が開いているworkspace外にある場合は結合を開始せず、workspace外であることを示すエラーメッセージを表示する', async () => {
    await using outsideDirectory = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-command-'));

    const firstSourcePath = path.join(outsideDirectory.path, 'first.png');
    const secondSourcePath = path.join(outsideDirectory.path, 'second.png');
    await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);

    await vscode.commands.executeCommand('graphics-workbench.combineImagesToPdf', vscode.Uri.file(firstSourcePath), [
      vscode.Uri.file(firstSourcePath),
      vscode.Uri.file(secondSourcePath),
    ]);

    assert.ok(showErrorMessage.calledOnce);
    assert.match(String(showErrorMessage.firstCall.args[0]), /inside an open workspace/);
  });

  test('untitledなどfileスキーム以外の2つの入力uriは結合を開始せず、"Only local files"を含むエラーメッセージを表示する', async () => {
    await vscode.commands.executeCommand(
      'graphics-workbench.combineImagesToPdf',
      vscode.Uri.parse('untitled:test.png'),
      [vscode.Uri.parse('untitled:test.png'), vscode.Uri.parse('untitled:test2.png')],
    );

    assert.ok(showErrorMessage.calledOnce);
    assert.match(String(showErrorMessage.firstCall.args[0]), /Only local files/);
  });

  test('2枚のPNG入力で結合順を確認した後、Saveダイアログで選択したパスへ結合PDFを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'selected.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));

      await runCommandAndClearNotificationsUntilDone(
        vscode.commands.executeCommand('graphics-workbench.combineImagesToPdf', vscode.Uri.file(firstSourcePath), [
          vscode.Uri.file(firstSourcePath),
          vscode.Uri.file(secondSourcePath),
        ]),
      );

      assert.strictEqual(showErrorMessage.called, false, String(showErrorMessage.firstCall?.args[0]));
      assert.strictEqual(showSaveDialog.calledOnce, true);
      await access(outputPath);
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('Saveダイアログをキャンセルした場合、結合PDFを作成しない', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'cancelled.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(undefined);

      await vscode.commands.executeCommand('graphics-workbench.combineImagesToPdf', vscode.Uri.file(firstSourcePath), [
        vscode.Uri.file(firstSourcePath),
        vscode.Uri.file(secondSourcePath),
      ]);

      await assertFileDoesNotExist(outputPath);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('2枚のPNG入力の結合中にVS Code進捗通知へ「準備中」と「1/2、2/2完了」のメッセージを報告し、結合PDFを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'combined-progress.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));

      const progressMessages: string[] = [];
      sandbox.stub(vscode.window, 'withProgress').callsFake(async (_options, task) =>
        task(
          {
            report: (value) => {
              if (value.message !== undefined) {
                progressMessages.push(value.message);
              }
            },
          },
          {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => undefined }),
          },
        ),
      );

      await vscode.commands.executeCommand('graphics-workbench.combineImagesToPdf', vscode.Uri.file(firstSourcePath), [
        vscode.Uri.file(firstSourcePath),
        vscode.Uri.file(secondSourcePath),
      ]);

      assert.strictEqual(showErrorMessage.called, false, String(showErrorMessage.firstCall?.args[0]));
      assert.deepStrictEqual(progressMessages, [
        userMessage('message.progress.prepareConversion', 'PDF'),
        userMessage('message.progress.completedCount', 1, 2),
        userMessage('message.progress.completedCount', 2, 2),
      ]);
      await access(outputPath);
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('プレビューで2番目の入力の移動ボタンと1番目の入力の除外ボタンを押した場合、残った2番目の入力だけを返す', async () => {
    const quickPick = createFakeQuickPick((pick) => {
      const second = requireValue(pick.items[1]);
      const first = requireValue(pick.items[0]);
      pick.triggerItemButton(second, requireValue(requireValue(second.buttons)[0]));
      pick.triggerItemButton(first, requireValue(requireValue(first.buttons)[2]));
      pick.accept();
    });
    createQuickPick.callsFake(() => quickPick);
    const sourceUris = [vscode.Uri.file('/workspace/a.png'), vscode.Uri.file('/workspace/b.png')];

    assert.deepStrictEqual(await previewCombineInputs(sourceUris, () => quickPick), [sourceUris[1]]);
  });

  test('プレビューで全入力を除外した場合、Saveダイアログを開かず出力PDFも作成しない', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePaths = [path.join(temporaryDirectory, 'first.png'), path.join(temporaryDirectory, 'second.png')];
      const outputPath = path.join(temporaryDirectory, 'selected.pdf');
      await Promise.all(sourcePaths.map((sourcePath) => copyFile(VALID_PNG, sourcePath)));
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');
      const quickPick = createFakeQuickPick((pick) => pick.hide());
      createQuickPick.callsFake(() => quickPick);

      await vscode.commands.executeCommand(
        'graphics-workbench.combineImagesToPdf',
        vscode.Uri.file(requireValue(sourcePaths[0])),
        [vscode.Uri.file(requireValue(sourcePaths[0])), vscode.Uri.file(requireValue(sourcePaths[1]))],
      );

      await assertFileDoesNotExist(outputPath);
      assert.strictEqual(showSaveDialog.called, false);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('既存の出力PDFを上書きする結合を実行すると、変換結果をworkspace内の一時作業ディレクトリ（.graphics-workbench配下）に保存し、上書き前の旧PDFをバックアップとして保持する。Undo実行で出力PDFを旧内容へ復元し、その一時作業ディレクトリを削除する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'combined.pdf');
      const originalOutput = Buffer.from('original output');
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      assert.ok(workspacePath);
      const stagingRoot = path.join(workspacePath, '.graphics-workbench', 'combine-images');
      const existingRunDirectories = new Set(await readDirectoryNames(stagingRoot));
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      await writeFile(outputPath, originalOutput);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves({
        title: userMessage('message.safeMode.overwrite'),
      });
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));

      await runCommandAndClearNotificationsUntilDone(
        vscode.commands.executeCommand('graphics-workbench.combineImagesToPdf', vscode.Uri.file(firstSourcePath), [
          vscode.Uri.file(firstSourcePath),
          vscode.Uri.file(secondSourcePath),
        ]),
      );

      assert.strictEqual(showErrorMessage.called, false, String(showErrorMessage.firstCall?.args[0]));
      const runDirectories = (await readDirectoryNames(stagingRoot)).filter(
        (runDirectory) => !existingRunDirectories.has(runDirectory),
      );
      assert.strictEqual(runDirectories.length, 1);
      const runRoot = path.join(stagingRoot, requireValue(runDirectories[0]));
      await access(path.join(runRoot, 'result.pdf.previous'));
      await assertFileDoesNotExist(path.join(runRoot, 'result.pdf'));

      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');

      assert.deepStrictEqual(await readFile(outputPath), originalOutput);
      await assertDirectoryMissingOrEmpty(path.join(stagingRoot, requireValue(runDirectories[0])));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('キャンセル済みトークンで進捗が開始された場合、出力PDFを作成せず変換キャンセルの標準通知を表示する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'combined.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));
      const cancelledToken = {
        isCancellationRequested: true,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken;
      sandbox
        .stub(vscode.window, 'withProgress')
        .callsFake(async (_options, task) => task({ report: () => undefined }, cancelledToken));

      await vscode.commands.executeCommand('graphics-workbench.combineImagesToPdf', vscode.Uri.file(firstSourcePath), [
        vscode.Uri.file(firstSourcePath),
        vscode.Uri.file(secondSourcePath),
      ]);

      await assertFileDoesNotExist(outputPath);
      assert.ok(showInformationMessage.calledWith(userMessage('message.convertToOutput.cancelled', 'PDF')));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('Quick CombineはプレビューもSaveダイアログも表示せず、outputPath.combine.pdfの${random}を展開したworkspace内パスへ結合PDFを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.combine.pdf': '${workspaceFolder}/quick-combined-${random}.pdf',
        },
        async () => {
          await runCommandAndClearNotificationsUntilDone(
            vscode.commands.executeCommand(
              'graphics-workbench.quickCombineImagesToPdf',
              vscode.Uri.file(firstSourcePath),
              [vscode.Uri.file(firstSourcePath), vscode.Uri.file(secondSourcePath)],
            ),
          );
        },
      );

      assert.strictEqual(showErrorMessage.called, false, String(showErrorMessage.firstCall?.args[0]));
      assert.strictEqual(showSaveDialog.called, false);
      assert.ok(!createQuickPick.called, 'Quick Combine must not show the order preview');
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(workspaceFolder);
      const matches = (await readdir(workspaceFolder.uri.fsPath)).filter((name) =>
        /^quick-combined-[0-9a-f]{8}\.pdf$/u.test(name),
      );
      assert.strictEqual(matches.length, 1, `expected one quick-combined PDF, found: ${matches.join(', ')}`);
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('Quick Combineは単一入力では結合せず、2件以上必要であることを示すエラーメッセージを表示して通常Convertへフォールバックしない', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'single.png');
      await copyFile(VALID_PNG, sourcePath);
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');
      const convertToPdf = sandbox.stub(vscode.commands, 'executeCommand').callThrough();

      await vscode.commands.executeCommand('graphics-workbench.quickCombineImagesToPdf', vscode.Uri.file(sourcePath), [
        vscode.Uri.file(sourcePath),
      ]);

      assert.ok(showErrorMessage.calledOnce);
      assert.match(String(showErrorMessage.firstCall.args[0]), /at least two/);
      assert.strictEqual(showSaveDialog.called, false);
      const executed = convertToPdf.getCalls().map((call) => call.args[0]);
      assert.ok(!executed.includes('graphics-workbench.convertToPdf'), 'must not fall back to Convert to PDF');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('Quick CombineでoutputPath.combine.pdfに${random}が無い場合は、invalid configurationとして結合せずエラーを表示する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'combined.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.combine.pdf': '${workspaceFolder}/combined.pdf',
        },
        async () => {
          await vscode.commands.executeCommand(
            'graphics-workbench.quickCombineImagesToPdf',
            vscode.Uri.file(firstSourcePath),
            [vscode.Uri.file(firstSourcePath), vscode.Uri.file(secondSourcePath)],
          );
        },
      );

      assert.ok(showErrorMessage.calledOnce);
      assert.match(String(showErrorMessage.firstCall.args[0]), /must contain \$\{random\}/);
      await assertFileDoesNotExist(outputPath);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('Quick CombineでoutputPath.combine.pdfが空文字の場合はinvalid configurationとして結合せずエラーを表示する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.combine.pdf': '',
        },
        async () => {
          await vscode.commands.executeCommand(
            'graphics-workbench.quickCombineImagesToPdf',
            vscode.Uri.file(firstSourcePath),
            [vscode.Uri.file(firstSourcePath), vscode.Uri.file(secondSourcePath)],
          );
        },
      );

      assert.ok(showErrorMessage.calledOnce);
      assert.match(
        String(showErrorMessage.firstCall.args[0]),
        /Invalid configuration for graphics-workbench\.outputPath\.combine\.pdf/,
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  return mkdtemp(path.join(workspaceFolder.uri.fsPath, 'gw-combine-command-'));
}

async function assertFileDoesNotExist(filePath: string): Promise<void> {
  await assert.rejects(access(filePath));
}

async function assertDirectoryMissingOrEmpty(directoryPath: string): Promise<void> {
  try {
    assert.deepStrictEqual(await readdir(directoryPath), []);
  } catch (error) {
    assert.ok(error instanceof Error && 'code' in error && error.code === 'ENOENT');
  }
}

async function readDirectoryNames(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}

function createFakeQuickPick(onShow: (quickPick: FakeQuickPick) => void): FakeQuickPick {
  return new FakeQuickPick(onShow);
}

class FakeQuickPick implements vscode.QuickPick<CombinePreviewItem> {
  title: string | undefined;
  step: number | undefined;
  totalSteps: number | undefined;
  enabled = true;
  busy = false;
  ignoreFocusOut = false;
  value = '';
  placeholder: string | undefined;
  prompt: string | undefined;
  buttons: readonly vscode.QuickInputButton[] = [];
  items: readonly CombinePreviewItem[] = [];
  canSelectMany = false;
  matchOnDescription = false;
  matchOnDetail = false;
  keepScrollPosition = false;
  activeItems: readonly CombinePreviewItem[] = [];
  selectedItems: readonly CombinePreviewItem[] = [];

  private acceptListener: (() => void) | undefined;
  private hideListener: (() => void) | undefined;
  private itemButtonListener: ((event: vscode.QuickPickItemButtonEvent<CombinePreviewItem>) => void) | undefined;

  readonly onDidHide: vscode.Event<void> = (listener) => {
    this.hideListener = listener;
    return new FakeDisposable();
  };
  readonly onDidChangeValue: vscode.Event<string> = () => new FakeDisposable();
  readonly onDidAccept: vscode.Event<void> = (listener) => {
    this.acceptListener = listener;
    return new FakeDisposable();
  };
  readonly onDidTriggerButton: vscode.Event<vscode.QuickInputButton> = () => new FakeDisposable();
  readonly onDidTriggerItemButton: vscode.Event<vscode.QuickPickItemButtonEvent<CombinePreviewItem>> = (listener) => {
    this.itemButtonListener = listener;
    return new FakeDisposable();
  };
  readonly onDidChangeActive: vscode.Event<readonly CombinePreviewItem[]> = () => new FakeDisposable();
  readonly onDidChangeSelection: vscode.Event<readonly CombinePreviewItem[]> = () => new FakeDisposable();

  readonly onShow: (quickPick: FakeQuickPick) => void;

  constructor(onShow: (quickPick: FakeQuickPick) => void) {
    this.onShow = onShow;
  }

  show(): void {
    this.onShow(this);
  }

  hide(): void {
    this.hideListener?.();
  }

  dispose(): void {}

  accept(): void {
    this.acceptListener?.();
  }

  triggerItemButton(item: CombinePreviewItem, button: vscode.QuickInputButton): void {
    this.itemButtonListener?.({ item, button });
  }
}

class FakeDisposable implements vscode.Disposable {
  dispose(): void {}
}
