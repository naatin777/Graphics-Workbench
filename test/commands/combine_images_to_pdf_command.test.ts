import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { type CombinePreviewItem, previewCombineInputs } from '../../src/commands/conversion/combine_images_to_pdf.js';
import { userMessage } from '../../src/commands/shared/user_messages.js';

import { operationPngInputPath } from '../helpers/fixture_paths.js';
import { runCommandAndClearNotificationsUntilDone } from '../helpers/vscode_command.js';
import { requireValue } from '../helpers/required.js';
import { withWorkspaceSettings } from '../helpers/workspace_settings.js';

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

  test('コマンドが登録されている', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('graphics-workbench.convertImagesToSinglePdf'));
  });

  test('open workspace外の入力をworkspaceとして扱わない', async () => {
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-combine-command-'));

    try {
      const sourcePath = path.join(outsideDirectory, 'outside.png');
      await copyFile(VALID_PNG, sourcePath);

      await vscode.commands.executeCommand('graphics-workbench.convertImagesToSinglePdf', vscode.Uri.file(sourcePath));

      assert.ok(showErrorMessage.calledOnce);
      assert.match(String(showErrorMessage.firstCall.args[0]), /inside an open workspace/);
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  test('file scheme以外の入力を拒否する', async () => {
    await vscode.commands.executeCommand(
      'graphics-workbench.convertImagesToSinglePdf',
      vscode.Uri.parse('untitled:test.png'),
    );

    assert.ok(showErrorMessage.calledOnce);
    assert.match(String(showErrorMessage.firstCall.args[0]), /Only local files/);
  });

  test('単一入力で設定済み相対テンプレートをSaveダイアログなしで解決する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'nested', 'source.png');
      const outputPath = path.join(temporaryDirectory, 'nested', 'custom-source.pdf');
      await mkdir(path.dirname(sourcePath));
      await copyFile(VALID_PNG, sourcePath);
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.convertImagesToSinglePdf':
            '${relativeFileDirname}/custom-${fileBasenameNoExtension}.pdf',
        },
        async () => {
          await runCommandAndClearNotificationsUntilDone(
            vscode.commands.executeCommand('graphics-workbench.convertImagesToSinglePdf', vscode.Uri.file(sourcePath)),
          );
        },
      );

      assert.strictEqual(showErrorMessage.called, false, String(showErrorMessage.firstCall?.args[0]));
      await access(outputPath);
      assert.strictEqual(showSaveDialog.called, false);
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('複数入力で明示的に設定されたテンプレートをSaveダイアログなしで使用する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'combined-first.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.convertImagesToSinglePdf':
            '${fileDirname}/combined-${fileBasenameNoExtension}.pdf',
        },
        async () => {
          await runCommandAndClearNotificationsUntilDone(
            vscode.commands.executeCommand(
              'graphics-workbench.convertImagesToSinglePdf',
              vscode.Uri.file(firstSourcePath),
              [vscode.Uri.file(firstSourcePath), vscode.Uri.file(secondSourcePath)],
            ),
          );
        },
      );

      assert.strictEqual(showErrorMessage.called, false, String(showErrorMessage.firstCall?.args[0]));
      await access(outputPath);
      assert.strictEqual(showSaveDialog.called, false);
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('完了した画像変換をVS Code進捗通知でM/Nとして報告する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'combined-progress.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);

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

      await withWorkspaceSettings(
        { 'graphics-workbench.outputPath.convertImagesToSinglePdf': '${fileDirname}/combined-progress.pdf' },
        async () => {
          await vscode.commands.executeCommand(
            'graphics-workbench.convertImagesToSinglePdf',
            vscode.Uri.file(firstSourcePath),
            [vscode.Uri.file(firstSourcePath), vscode.Uri.file(secondSourcePath)],
          );
        },
      );

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

  test('テンプレート未設定の複数入力でSaveダイアログを表示する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const firstSourcePath = path.join(temporaryDirectory, 'first.png');
      const secondSourcePath = path.join(temporaryDirectory, 'second.png');
      const outputPath = path.join(temporaryDirectory, 'selected.pdf');
      await Promise.all([copyFile(VALID_PNG, firstSourcePath), copyFile(VALID_PNG, secondSourcePath)]);
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog').resolves(vscode.Uri.file(outputPath));

      await withWorkspaceSettings({ 'graphics-workbench.outputPath.convertImagesToSinglePdf': undefined }, async () => {
        await runCommandAndClearNotificationsUntilDone(
          vscode.commands.executeCommand(
            'graphics-workbench.convertImagesToSinglePdf',
            vscode.Uri.file(firstSourcePath),
            [vscode.Uri.file(firstSourcePath), vscode.Uri.file(secondSourcePath)],
          ),
        );
      });

      assert.strictEqual(showErrorMessage.called, false, String(showErrorMessage.firstCall?.args[0]));
      assert.strictEqual(showSaveDialog.calledOnce, true);
      await access(outputPath);
      await vscode.commands.executeCommand('graphics-workbench.undoLastConversion');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('プレビューは入力順を保持し、入力の移動と除外が可能', async () => {
    const quickPick = createFakeQuickPick((pick) => {
      const second = requireValue(pick.items[1]);
      const first = requireValue(pick.items[0]);
      pick.triggerItemButton(second, requireValue(requireValue(second.buttons)[0]));
      pick.triggerItemButton(first, requireValue(requireValue(first.buttons)[2]));
      pick.accept();
    });
    createQuickPick.callsFake(() => quickPick);
    const sourceUris = [vscode.Uri.file('/workspace/a.png'), vscode.Uri.file('/workspace/b.png')];

    assert.deepStrictEqual(await previewCombineInputs(sourceUris), [sourceUris[1]]);
  });

  test('プレビューキャンセル時にSaveダイアログを開かず出力も作成しない', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePaths = [path.join(temporaryDirectory, 'first.png'), path.join(temporaryDirectory, 'second.png')];
      const outputPath = path.join(temporaryDirectory, 'selected.pdf');
      await Promise.all(sourcePaths.map((sourcePath) => copyFile(VALID_PNG, sourcePath)));
      const showSaveDialog = sandbox.stub(vscode.window, 'showSaveDialog');
      const quickPick = createFakeQuickPick((pick) => pick.hide());
      createQuickPick.callsFake(() => quickPick);

      await vscode.commands.executeCommand(
        'graphics-workbench.convertImagesToSinglePdf',
        vscode.Uri.file(requireValue(sourcePaths[0])),
        [vscode.Uri.file(requireValue(sourcePaths[0])), vscode.Uri.file(requireValue(sourcePaths[1]))],
      );

      await assertFileDoesNotExist(outputPath);
      assert.strictEqual(showSaveDialog.called, false);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('Undoを登録し、成功したステージングを削除し、上書きバックアップのみを保持する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.png');
      const outputPath = path.join(temporaryDirectory, 'source.pdf');
      const originalOutput = Buffer.from('original output');
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      assert.ok(workspacePath);
      const stagingRoot = path.join(workspacePath, '.graphics-workbench', 'combine-images');
      const existingRunDirectories = new Set(await readDirectoryNames(stagingRoot));
      await copyFile(VALID_PNG, sourcePath);
      await writeFile(outputPath, originalOutput);
      sandbox.stub(vscode.window, 'showWarningMessage').resolves({
        title: userMessage('message.safeMode.overwrite'),
      });

      await runCommandAndClearNotificationsUntilDone(
        vscode.commands.executeCommand('graphics-workbench.convertImagesToSinglePdf', vscode.Uri.file(sourcePath)),
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

  test('キャンセル済みトークンで進捗が開始された場合はコミットせず標準通知を表示する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.png');
      const outputPath = path.join(temporaryDirectory, 'source.pdf');
      await copyFile(VALID_PNG, sourcePath);
      const cancelledToken = {
        isCancellationRequested: true,
        onCancellationRequested: () => ({ dispose: () => undefined }),
      } as vscode.CancellationToken;
      sandbox
        .stub(vscode.window, 'withProgress')
        .callsFake(async (_options, task) => task({ report: () => undefined }, cancelledToken));

      await vscode.commands.executeCommand('graphics-workbench.convertImagesToSinglePdf', vscode.Uri.file(sourcePath));

      await assertFileDoesNotExist(outputPath);
      assert.ok(showInformationMessage.calledWith(userMessage('message.convertToOutput.cancelled', 'PDF')));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  return mkdtemp(path.join(workspaceFolder.uri.fsPath, 'graphics-workbench-combine-command-'));
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
