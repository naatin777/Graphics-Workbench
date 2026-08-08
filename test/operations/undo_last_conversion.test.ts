// Test target:
// - 直前の変換出力が生成時から変更されていない場合だけ、全出力を削除すること
// - 変更、欠損、workspace外symlinkが1件でもあれば、削除を開始しないこと
//
// Mocked:
// - なし。実ファイルと実際のSHA-256計算を使用する
//
// Not tested:
// - VS Codeの通知UI
// - command登録
// - crop処理

import assert from 'node:assert/strict';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  mkdtempDisposable,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSandbox, type SinonSandbox } from 'sinon';
import * as vscode from 'vscode';

import {
  recordConversionForUndo,
  undoLastConversionCommand,
} from '../../src/commands/lifecycle/undo_last_conversion.js';
import {
  createConversionUndoRecord,
  undoConversionOutputs,
} from '../../src/operations/lifecycle/undo_last_conversion.js';
import { commitStagedOutputs } from '../../src/operations/lifecycle/commit_conversion_outputs.js';

suite('直前変換の取り消し処理', () => {
  let sandbox: SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('1回目の変換を記録した後で2回目の変換を記録しても、変換1・変換2それぞれの前回内容ファイルを削除せず、どちらの変換も後から取り消せる状態を保つ', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const firstOutputPath = path.join(workspacePath.path, 'first.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'second.pdf');
    const firstRoot = path.join(workspacePath.path, '.graphics-workbench', 'first');
    const secondRoot = path.join(workspacePath.path, '.graphics-workbench', 'second');
    const firstBackupPath = path.join(firstRoot, 'first.previous');
    const secondBackupPath = path.join(secondRoot, 'second.previous');

    await writeFixture(firstOutputPath, 'generated-first');
    await writeFixture(firstBackupPath, 'original-first');
    await recordConversionForUndo([
      {
        outputPath: firstOutputPath,
        workspacePath: workspacePath.path,
        previousFilePath: firstBackupPath,
        stagingRootPath: firstRoot,
      },
    ]);
    await assert.doesNotReject(access(firstBackupPath));

    await writeFixture(secondOutputPath, 'generated-second');
    await writeFixture(secondBackupPath, 'original-second');
    await recordConversionForUndo([
      {
        outputPath: secondOutputPath,
        workspacePath: workspacePath.path,
        previousFilePath: secondBackupPath,
        stagingRootPath: secondRoot,
      },
    ]);

    await assert.doesNotReject(access(firstBackupPath));
    await assert.doesNotReject(access(secondBackupPath));
  });

  test('同じ出力に対して2つの変換を記録し、新しい変換から順に取り消す。前回内容がある変換は出力を前回内容へ戻し、前回内容の記録が無い変換は出力を削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const firstRoot = path.join(workspacePath.path, '.graphics-workbench', 'first');
    const secondRoot = path.join(workspacePath.path, '.graphics-workbench', 'second');

    await writeFixture(outputPath, 'first');
    const firstRecordId = await recordConversionForUndo([
      { outputPath, workspacePath: workspacePath.path, stagingRootPath: firstRoot },
    ]);

    const secondBackupPath = path.join(secondRoot, 'output.previous');
    await writeFixture(secondBackupPath, 'first');
    await writeFixture(outputPath, 'second');
    const secondRecordId = await recordConversionForUndo([
      {
        outputPath,
        workspacePath: workspacePath.path,
        previousFilePath: secondBackupPath,
        stagingRootPath: secondRoot,
      },
    ]);

    await undoLastConversionCommand(secondRecordId);
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'first');
    await undoLastConversionCommand(firstRecordId);
    await assert.rejects(access(outputPath));
  });

  test('上書き変換のUndoで出力を前回内容ファイルの内容へ復元した後、変換作業用ディレクトリごと前回ファイルを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const previousFilePath = path.join(rootPath, 'output.previous');

    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');
    const record = await createConversionUndoRecord([
      { outputPath, workspacePath: workspacePath.path, previousFilePath, stagingRootPath: rootPath },
    ]);

    await undoConversionOutputs(record);

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
    await assert.rejects(access(previousFilePath));
  });

  test('生成時から変更されていない2つの出力PDFを削除し、記録に含まれないworkspace内の作業ファイルは削除しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const firstOutputPath = path.join(workspacePath, 'output', 'first.pdf');
    const secondOutputPath = path.join(workspacePath, 'output', 'second.pdf');
    const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', 'crop-pdf', 'run', 'result.pdf');
    await writeFixture(firstOutputPath, 'first');
    await writeFixture(secondOutputPath, 'second');
    await writeFixture(stagedOutputPath, 'staged');

    const record = await createConversionUndoRecord([
      { outputPath: firstOutputPath, workspacePath },
      { outputPath: secondOutputPath, workspacePath },
    ]);

    await undoConversionOutputs(record);

    await assert.rejects(access(firstOutputPath));
    await assert.rejects(access(secondOutputPath));
    await assert.doesNotReject(access(stagedOutputPath));
  });

  test('変換後に出力の1つのSHA-256が変化している場合は削除を開始せず、どの出力も削除しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const firstOutputPath = path.join(workspacePath, 'first.pdf');
    const secondOutputPath = path.join(workspacePath, 'second.pdf');
    await writeFixture(firstOutputPath, 'first');
    await writeFixture(secondOutputPath, 'second');

    const record = await createConversionUndoRecord([
      { outputPath: firstOutputPath, workspacePath },
      { outputPath: secondOutputPath, workspacePath },
    ]);
    await writeFile(secondOutputPath, 'edited');

    await assert.rejects(undoConversionOutputs(record), /changed after conversion/);
    await assert.doesNotReject(access(firstOutputPath));
    await assert.doesNotReject(access(secondOutputPath));
  });

  test('変換後に出力の1つが削除されて存在しない場合はUndoを中止し、残りの出力も削除しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const firstOutputPath = path.join(workspacePath, 'first.pdf');
    const secondOutputPath = path.join(workspacePath, 'second.pdf');
    await writeFixture(firstOutputPath, 'first');
    await writeFixture(secondOutputPath, 'second');

    const record = await createConversionUndoRecord([
      { outputPath: firstOutputPath, workspacePath },
      { outputPath: secondOutputPath, workspacePath },
    ]);
    await rm(secondOutputPath);

    await assert.rejects(undoConversionOutputs(record));
    await assert.doesNotReject(access(firstOutputPath));
  });

  test('変換後に出力の1つがworkspace外の実体を指すsymlinkへ差し替えられた場合は実体パス判定で拒否し、どの出力も削除しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const outsidePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'gw-undo-outside-')), 'outside.pdf');
    const firstOutputPath = path.join(workspacePath, 'first.pdf');
    const secondOutputPath = path.join(workspacePath, 'second.pdf');
    await writeFixture(outsidePath, 'outside');
    await writeFixture(firstOutputPath, 'first');
    await writeFixture(secondOutputPath, 'second');

    const record = await createConversionUndoRecord([
      { outputPath: firstOutputPath, workspacePath },
      { outputPath: secondOutputPath, workspacePath },
    ]);
    await rm(secondOutputPath);
    await symlink(outsidePath, secondOutputPath);

    await assert.rejects(undoConversionOutputs(record), /outside the workspace/);
    await assert.doesNotReject(access(firstOutputPath));
    await assert.doesNotReject(access(outsidePath));
  });

  test('上書きされた出力のUndoで前回内容ファイルの内容を出力へコピーして復元し、作業用ディレクトリの記録が無い場合は前回ファイルも残す', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const outputPath = path.join(workspacePath, 'output.pdf');
    const previousFilePath = path.join(workspacePath, '.graphics-workbench', 'output.previous');
    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');

    const record = await createConversionUndoRecord([{ outputPath, workspacePath, previousFilePath }]);

    await undoConversionOutputs(record);

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
    await assert.doesNotReject(access(previousFilePath));
  });

  test('上書きされた出力のUndoで元の内容に加えて、変換前に記録したmodeとmtime/atimeも復元する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const stagedOutputPath = path.join(workspacePath.path, '.graphics-workbench', 'run', 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const originalMtime = new Date(2005, 5, 15, 12, 34, 56, 789);

    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'original');
    await utimes(outputPath, originalMtime, originalMtime);
    if (process.platform !== 'win32') {
      await chmod(outputPath, 0o640);
    }

    const committed = await commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path }], {
      resolveConflicts: async () => 'overwrite',
    });
    assert.ok(committed[0]?.previousFileMetadata);
    const record = await createConversionUndoRecord(committed);

    await undoConversionOutputs(record);

    const restored = await stat(outputPath);
    assert.strictEqual(restored.mtimeMs, originalMtime.getTime());
    assert.strictEqual(restored.atimeMs, committed[0]?.previousFileMetadata?.atimeMs);
    if (process.platform !== 'win32') {
      assert.strictEqual(restored.mode & 0o7777, 0o640);
    }
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
  });

  test('変換後に出力のSHA-256が変化している場合はUndoを中止し、上書き前のファイルを復元せず編集後の内容を維持する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const outputPath = path.join(workspacePath, 'output.pdf');
    const previousFilePath = path.join(workspacePath, '.graphics-workbench', 'output.previous');
    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');

    const record = await createConversionUndoRecord([{ outputPath, workspacePath, previousFilePath }]);
    await writeFile(outputPath, 'edited');

    await assert.rejects(undoConversionOutputs(record), /changed after conversion/);
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'edited');
  });
});

async function writeFixture(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}
