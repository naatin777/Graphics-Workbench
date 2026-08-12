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
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
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
} from '../../../src/commands/lifecycle/undo_last_conversion.js';
import {
  createConversionUndoRecord,
  UndoCleanupError,
  undoConversionOutputs,
} from '../../../src/policy/undo_last_conversion.js';
import { commitStagedOutputs } from '@graphics-workbench/core/runtime';
import { liveCommandDependencies } from '../../support/helpers/command_dependencies.js';

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

    await undoLastConversionCommand(secondRecordId, liveCommandDependencies());
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'first');
    await undoLastConversionCommand(firstRecordId, liveCommandDependencies());
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

  test('出力のUndo成功後にrollback-copy directoryの削除だけ失敗した場合はUndoを成功扱いにし、cleanup failureとしてrootを返して再試行可能にする', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-cleanup-failure-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    await writeFixture(outputPath, 'generated');
    const record = await createConversionUndoRecord([{ outputPath, workspacePath: workspacePath.path }]);

    const cleanup = await undoConversionOutputs(record, undefined, {
      removeRollbackRoot: async (targetPath, options) => {
        if (String(targetPath).includes(`${path.sep}undo-rollback${path.sep}`)) {
          throw new Error('injected rollback cleanup failure');
        }
        return rm(targetPath, options);
      },
    });

    await assert.rejects(access(outputPath));
    assert.strictEqual(cleanup.failures.length, 1);
    assert.match(cleanup.failures[0]?.rootPath ?? '', /undo-rollback/);
    assert.match(cleanup.failures[0]?.error.message ?? '', /injected rollback cleanup failure/);
    await assert.doesNotReject(access(cleanup.failures[0]?.rootPath ?? ''));
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

  test('2つの新規出力を取り消す途中で1つ目を削除した後に2つ目が外部編集された場合は、Undoを中止して削除済みの1つ目だけを元へ戻し、未処理の2つ目は外部編集後の内容を上書きしない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const firstOutputPath = path.join(workspacePath.path, 'first.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'second.pdf');
    await writeFixture(firstOutputPath, 'first');
    await writeFile(secondOutputPath, Buffer.alloc(8 * 1024 * 1024, 0x78));

    const record = await createConversionUndoRecord([
      { outputPath: firstOutputPath, workspacePath: workspacePath.path },
      { outputPath: secondOutputPath, workspacePath: workspacePath.path },
    ]);
    const externalEdit = writeAfterPathDisappears(firstOutputPath, secondOutputPath, 'external edit');

    await assert.rejects(undoConversionOutputs(record), /changed after input/);
    await externalEdit;

    assert.strictEqual(await readFile(firstOutputPath, 'utf8'), 'first');
    assert.strictEqual(await readFile(secondOutputPath, 'utf8'), 'external edit');
  });

  test('Undo本処理をrollbackした後にrollback-copy directoryの削除が失敗した場合は、元のUndo失敗とcleanup rootをUndoCleanupErrorへ保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-failure-cleanup-'));
    const firstOutputPath = path.join(workspacePath.path, 'first.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'second.pdf');
    await writeFixture(firstOutputPath, 'first');
    await writeFile(secondOutputPath, Buffer.alloc(8 * 1024 * 1024, 0x78));
    const record = await createConversionUndoRecord([
      { outputPath: firstOutputPath, workspacePath: workspacePath.path },
      { outputPath: secondOutputPath, workspacePath: workspacePath.path },
    ]);
    const externalEdit = writeAfterPathDisappears(firstOutputPath, secondOutputPath, 'external edit');

    await assert.rejects(
      undoConversionOutputs(record, undefined, {
        removeRollbackRoot: async () => {
          throw new Error('injected rollback cleanup failure');
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof UndoCleanupError);
        assert.match(error.originalError.message, /changed after input/);
        assert.strictEqual(error.cleanupResult.failures.length, 1);
        assert.match(error.cleanupResult.failures[0]?.rootPath ?? '', /undo-rollback/);
        return true;
      },
    );
    await externalEdit;

    assert.strictEqual(await readFile(firstOutputPath, 'utf8'), 'first');
    assert.strictEqual(await readFile(secondOutputPath, 'utf8'), 'external edit');
  });

  test('2つの新規出力を取り消す途中で削除済みの1つ目が外部再作成され、未処理の2つ目も外部編集された場合は、どちらも回復コピーで上書きせず外部変更後の内容を保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const firstOutputPath = path.join(workspacePath.path, 'first.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'second.pdf');
    await writeFixture(firstOutputPath, 'first');
    await writeFile(secondOutputPath, Buffer.alloc(8 * 1024 * 1024, 0x78));

    const record = await createConversionUndoRecord([
      { outputPath: firstOutputPath, workspacePath: workspacePath.path },
      { outputPath: secondOutputPath, workspacePath: workspacePath.path },
    ]);
    const externalEdits = (async () => {
      await waitForPathToDisappear(firstOutputPath);
      await writeFile(firstOutputPath, 'external replacement');
      await writeFile(secondOutputPath, 'external edit');
    })();

    let recoveryRootPath = '';
    await assert.rejects(undoConversionOutputs(record), (error: unknown) => {
      assert.ok(error instanceof UndoCleanupError);
      assert.match(error.originalError.message, /rollback was incomplete/);
      assert.strictEqual(error.cleanupResult.failures.length, 1);
      recoveryRootPath = error.cleanupResult.failures[0]?.rootPath ?? '';
      assert.match(recoveryRootPath, /undo-rollback/);
      return true;
    });
    await externalEdits;

    assert.strictEqual(await readFile(firstOutputPath, 'utf8'), 'external replacement');
    assert.strictEqual(await readFile(secondOutputPath, 'utf8'), 'external edit');
    await assert.doesNotReject(access(recoveryRootPath));
  });

  test('Undo直前のSHA-256検証中に出力親directoryがworkspace外へのsymlinkへ差し替えられた場合は、境界外の同名ファイルを削除せずUndoを拒否する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-parent-race-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-parent-race-outside-'));
    const outputDirectory = path.join(workspacePath.path, 'outputs');
    const displacedDirectory = path.join(workspacePath.path, 'outputs-before-swap');
    const outputPath = path.join(outputDirectory, 'result.pdf');
    const outsideOutputPath = path.join(outsidePath.path, 'result.pdf');
    await writeFixture(outputPath, '');
    await truncate(outputPath, 128 * 1024 * 1024);
    await writeFixture(outsideOutputPath, 'outside user file');
    const record = await createConversionUndoRecord([{ outputPath, workspacePath: workspacePath.path }]);

    const undo = undoConversionOutputs(record);
    const swap = (async () => {
      await waitForRollbackCopySize(workspacePath.path, 128 * 1024 * 1024);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await rename(outputDirectory, displacedDirectory);
      await symlink(outsidePath.path, outputDirectory);
    })();

    await assert.rejects(undo, /outside the workspace|replaced while its contents were being verified/);
    await swap;
    assert.strictEqual(await readFile(outsideOutputPath, 'utf8'), 'outside user file');
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

    await assert.rejects(undoConversionOutputs(record), /changed after input/);
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

  test('新規出力のcommit完了後からUndo履歴作成前までに出力が外部編集された場合は、commit時のSHA-256との不一致で履歴作成を拒否し、外部編集後の出力を削除可能な履歴として記録しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const stagedOutputPath = path.join(workspacePath.path, '.graphics-workbench', 'run', 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    await writeFixture(stagedOutputPath, 'generated');

    const committed = await commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path }]);
    await writeFile(outputPath, 'external edit before Undo record');

    await assert.rejects(createConversionUndoRecord(committed), /changed before Undo could be recorded/);
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'external edit before Undo record');
  });

  test('変換後に出力のSHA-256が変化している場合はUndoを中止し、上書き前のファイルを復元せず編集後の内容を維持する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const outputPath = path.join(workspacePath, 'output.pdf');
    const previousFilePath = path.join(workspacePath, '.graphics-workbench', 'output.previous');
    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');

    const record = await createConversionUndoRecord([{ outputPath, workspacePath, previousFilePath }]);
    await writeFile(outputPath, 'edited');

    await assert.rejects(undoConversionOutputs(record), /changed after input/);
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'edited');
  });
});

async function writeFixture(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function writeAfterPathDisappears(watchedPath: string, targetPath: string, contents: string): Promise<void> {
  await waitForPathToDisappear(watchedPath);
  await writeFile(targetPath, contents);
}

async function waitForPathToDisappear(watchedPath: string): Promise<void> {
  for (;;) {
    try {
      await access(watchedPath);
      await new Promise<void>((resolve) => setImmediate(resolve));
    } catch {
      return;
    }
  }
}

async function waitForRollbackCopySize(workspacePath: string, expectedSize: number): Promise<void> {
  const rollbackBasePath = path.join(workspacePath, '.graphics-workbench', 'undo-rollback');
  for (;;) {
    try {
      const roots = await readdir(rollbackBasePath);
      for (const root of roots) {
        if (await rollbackCopyHasExpectedSize(path.join(rollbackBasePath, root, '0.backup'), expectedSize)) {
          return;
        }
      }
    } catch {
      // The rollback root has not been created yet.
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function rollbackCopyHasExpectedSize(backupPath: string, expectedSize: number): Promise<boolean> {
  try {
    return (await stat(backupPath)).size === expectedSize;
  } catch {
    return false;
  }
}
