// Test target:
// - Undo履歴がメモリ内だけに保持され、上限を超えると最も古いrecordのバックアップが削除されること
// - workspaceState / manifest / retentionを使わず、セッション内だけで記録・取り消しが完結すること
// - recordは生成artifactだけを削除し、`.previous`とmanifest.jsonを保持すること
// - Undo成功後はstaging rootごとバックアップを削除すること
//
// Mocked:
// - なし。実ファイルと実際のSHA-256計算を使用する
//
// Not tested:
// - VS Codeの通知UI
// - command登録
// - Undo時のハッシュ検証・ロールバック（既存のundo_last_conversionテストが対象）

import assert from 'node:assert/strict';
import { access, mkdir, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { UndoHistoryManager } from '../../vscode/src/operations/lifecycle/undo_history_manager.js';
import type { ConversionOutput } from '../../vscode/src/operations/lifecycle/undo_last_conversion.js';

suite('Undo履歴マネージャの記録・保持・取り消し', () => {
  test('1回目の変換を記録した後で2回目の変換を記録しても、変換1・変換2それぞれの前回内容ファイルを削除せず、どちらの変換も後から取り消せる状態を保つ', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const manager = new UndoHistoryManager();
    const firstOutputPath = path.join(workspacePath.path, 'first.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'second.pdf');
    const firstRoot = path.join(workspacePath.path, '.graphics-workbench', 'first');
    const secondRoot = path.join(workspacePath.path, '.graphics-workbench', 'second');
    const firstBackupPath = path.join(firstRoot, 'first.previous');
    const secondBackupPath = path.join(secondRoot, 'second.previous');

    await writeFixture(firstOutputPath, 'generated-first');
    await writeFixture(firstBackupPath, 'original-first');
    await manager.record([
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
    await manager.record([
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

  test('上書きされた出力をUndoすると変換前の内容を復元し、新規作成された出力はUndoで削除される', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const manager = new UndoHistoryManager();
    const overwrittenOutputPath = path.join(workspacePath.path, 'overwritten.pdf');
    const newOutputPath = path.join(workspacePath.path, 'new.pdf');
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const previousFilePath = path.join(rootPath, 'overwritten.previous');
    await writeFixture(overwrittenOutputPath, 'generated-overwrite');
    await writeFixture(previousFilePath, 'original-overwrite');
    await writeFixture(newOutputPath, 'generated-new');

    await manager.record([
      {
        outputPath: overwrittenOutputPath,
        workspacePath: workspacePath.path,
        previousFilePath,
        stagingRootPath: rootPath,
      },
      { outputPath: newOutputPath, workspacePath: workspacePath.path, stagingRootPath: rootPath },
    ]);

    assert.strictEqual(await manager.undo(), 'done');
    assert.strictEqual(await readFile(overwrittenOutputPath, 'utf8'), 'original-overwrite');
    await assert.rejects(access(newOutputPath));
  });

  test('Undo履歴はLIFOで、直近の変換から順に取り消せる', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const manager = new UndoHistoryManager();
    const firstOutputPath = path.join(workspacePath.path, 'first.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'second.pdf');
    const firstRoot = path.join(workspacePath.path, '.graphics-workbench', 'first');
    const secondRoot = path.join(workspacePath.path, '.graphics-workbench', 'second');
    await writeFixture(firstOutputPath, 'first');
    await writeFixture(secondOutputPath, 'second');

    await manager.record([
      { outputPath: firstOutputPath, workspacePath: workspacePath.path, stagingRootPath: firstRoot },
    ]);
    await manager.record([
      { outputPath: secondOutputPath, workspacePath: workspacePath.path, stagingRootPath: secondRoot },
    ]);

    assert.strictEqual(await manager.undo(), 'done');
    await assert.rejects(access(secondOutputPath));
    await assert.doesNotReject(access(firstOutputPath));

    assert.strictEqual(await manager.undo(), 'done');
    await assert.rejects(access(firstOutputPath));
  });

  test('2件目の変換を記録した後に1件目の変換履歴のidを指定してundoを試みると、最新の変換履歴と不一致のため変換を元に戻さず『新しい変換が先行』の結果を返す', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-workspace-'));
    const manager = new UndoHistoryManager();
    const firstOutputPath = path.join(workspacePath.path, 'first.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'second.pdf');
    await writeFixture(firstOutputPath, 'first');
    await writeFixture(secondOutputPath, 'second');

    const firstRecordId = await manager.record([
      {
        outputPath: firstOutputPath,
        workspacePath: workspacePath.path,
        stagingRootPath: path.join(workspacePath.path, '.graphics-workbench', 'first'),
      },
    ]);
    await manager.record([
      {
        outputPath: secondOutputPath,
        workspacePath: workspacePath.path,
        stagingRootPath: path.join(workspacePath.path, '.graphics-workbench', 'second'),
      },
    ]);

    assert.strictEqual(await manager.undo(firstRecordId), 'newer-input');
    await assert.doesNotReject(access(firstOutputPath));
    await assert.doesNotReject(access(secondOutputPath));
  });

  test('変換履歴が1件も記録されていない状態でundoを呼ぶと、何もせず『履歴なし』の結果を返す', async () => {
    const manager = new UndoHistoryManager();
    assert.strictEqual(await manager.undo(), 'no-record');
  });

  test('11件目の変換を記録すると最古のUndoバックアップを削除して直近10件だけ保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const manager = new UndoHistoryManager();
    const records: (ConversionOutput & { previousFilePath: string })[] = [];

    for (let index = 1; index <= 11; index += 1) {
      const record = await makeRecordFixture(workspacePath.path, `record-${index}`);
      records.push(record);
      await manager.record([record]);
    }

    await assert.rejects(access(records[0]?.previousFilePath ?? ''));
    for (let index = 1; index < 11; index += 1) {
      await assert.doesNotReject(access(records[index]?.previousFilePath ?? ''));
    }

    const twelfth = await makeRecordFixture(workspacePath.path, 'record-12');
    await manager.record([twelfth]);

    await assert.rejects(access(records[0]?.previousFilePath ?? ''));
    await assert.rejects(access(records[1]?.previousFilePath ?? ''));
    await assert.doesNotReject(access(records[2]?.previousFilePath ?? ''));
  });

  test('上限を超えて追い出されたrecordが所有していたUndo用staging全体をcleanupする', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const manager = new UndoHistoryManager();
    const records: (ConversionOutput & { previousFilePath: string })[] = [];

    for (let index = 1; index <= 11; index += 1) {
      const record = await makeRecordFixture(workspacePath.path, `record-${index}`);
      records.push(record);
      await manager.record([record]);
    }

    const [evicted] = records;
    assert.ok(evicted);
    await assert.rejects(access(evicted.previousFilePath));
    await assert.rejects(access(path.dirname(evicted.previousFilePath)));
    await assert.doesNotReject(access(path.join(workspacePath.path, 'record-1.pdf')));
  });

  test('上限を2に設定したマネージャに3件目の変換を記録すると、最古のUndoバックアップだけを削除して直近2件を保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const manager = new UndoHistoryManager(2);
    const records: (ConversionOutput & { previousFilePath: string })[] = [];

    for (let index = 1; index <= 3; index += 1) {
      const record = await makeRecordFixture(workspacePath.path, `record-${index}`);
      records.push(record);
      await manager.record([record]);
    }

    await assert.rejects(access(records[0]?.previousFilePath ?? ''));
    await assert.doesNotReject(access(records[1]?.previousFilePath ?? ''));
    await assert.doesNotReject(access(records[2]?.previousFilePath ?? ''));
  });

  test('実行中に上限を減らすと、次の変換記録で上限を超えた最古のrecordを追い出してバックアップを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const manager = new UndoHistoryManager();
    const records: (ConversionOutput & { previousFilePath: string })[] = [];

    for (let index = 1; index <= 4; index += 1) {
      const record = await makeRecordFixture(workspacePath.path, `record-${index}`);
      records.push(record);
      await manager.record([record]);
    }
    await assert.doesNotReject(access(records[0]?.previousFilePath ?? ''));

    manager.setMaxRecords(2);
    const fifth = await makeRecordFixture(workspacePath.path, 'record-5');
    await manager.record([fifth]);

    await assert.rejects(access(records[0]?.previousFilePath ?? ''));
    await assert.rejects(access(records[1]?.previousFilePath ?? ''));
    await assert.rejects(access(records[2]?.previousFilePath ?? ''));
    await assert.doesNotReject(access(records[3]?.previousFilePath ?? ''));
    await assert.doesNotReject(access(fifth.previousFilePath));
  });

  test('上限に0以下や非整数を指定するとInvalid Undo history limitエラーで拒否する', () => {
    assert.throws(() => new UndoHistoryManager(0), /Invalid Undo history limit/);
    assert.throws(() => new UndoHistoryManager(-1), /Invalid Undo history limit/);
    assert.throws(() => new UndoHistoryManager(1.5), /Invalid Undo history limit/);
    const manager = new UndoHistoryManager();
    assert.throws(() => manager.setMaxRecords(0), /Invalid Undo history limit/);
  });

  test('新しく生成したUndoHistoryManagerには、前のマネージャのUndo履歴が存在しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const first = await makeRecordFixture(workspacePath.path, 'first');
    const manager = new UndoHistoryManager();
    await manager.record([first]);

    const restarted = new UndoHistoryManager();
    assert.strictEqual(await restarted.undo(), 'no-record');
    await assert.doesNotReject(access(first.previousFilePath));
  });

  test('workspaceStateやmanifestストレージを使わずに記録・取り消しできる', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const previousFilePath = path.join(rootPath, 'output.previous');
    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');
    const manager = new UndoHistoryManager();

    const recordId = await manager.record([
      { outputPath, workspacePath: workspacePath.path, previousFilePath, stagingRootPath: rootPath },
    ]);
    assert.strictEqual(await manager.undo(recordId), 'done');
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
  });

  test('Undo成功後はrecordのstaging root全体と前回内容バックアップを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    await using stagingRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-secure-undo-root-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const previousFilePath = path.join(stagingRoot.path, 'output.previous');
    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');
    const manager = new UndoHistoryManager();

    const recordId = await manager.record([
      {
        outputPath,
        workspacePath: workspacePath.path,
        previousFilePath,
        stagingRootPath: stagingRoot.path,
        stagingWorkspacePath: stagingRoot.path,
      },
    ]);

    assert.strictEqual(await manager.undo(recordId), 'done');
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
    await assert.rejects(access(stagingRoot.path));
  });

  test('workspace外の機密PDF用rootにある上書き前バックアップを記録すると、生成artifactだけを削除してバックアップとmanifestを保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    await using stagingRoot = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-secure-undo-root-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const previousFilePath = path.join(stagingRoot.path, 'output.previous');
    const manifestPath = path.join(stagingRoot.path, 'manifest.json');
    const generatedArtifactPath = path.join(stagingRoot.path, 'generated.pdf');
    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');
    await writeFixture(manifestPath, '{"operation":"decrypt"}');
    await writeFixture(generatedArtifactPath, 'temporary generated artifact');
    const manager = new UndoHistoryManager();

    const recordId = await manager.record([
      {
        outputPath,
        workspacePath: workspacePath.path,
        previousFilePath,
        stagingRootPath: stagingRoot.path,
        stagingWorkspacePath: stagingRoot.path,
      },
    ]);

    assert.strictEqual(await readFile(previousFilePath, 'utf8'), 'original');
    assert.strictEqual(await readFile(manifestPath, 'utf8'), '{"operation":"decrypt"}');
    await assert.rejects(access(generatedArtifactPath));
    assert.ok(recordId);
  });

  test('変換履歴の記録に失敗しても上書き前バックアップとmanifest.jsonは保持し、不要な生成artifactだけを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const previousFilePath = path.join(rootPath, 'output.previous');
    const manifestPath = path.join(rootPath, 'manifest.json');
    const generatedArtifactPath = path.join(rootPath, 'result.pdf');
    await writeFixture(outputPath, 'generated');
    await writeFixture(previousFilePath, 'original');
    await writeFixture(manifestPath, '{"operation":"test"}');
    await writeFixture(generatedArtifactPath, 'temporary generated artifact');
    const manager = new UndoHistoryManager();

    await assert.rejects(
      manager.record([
        {
          outputPath,
          workspacePath: workspacePath.path,
          previousFilePath,
          stagingRootPath: rootPath,
          sha256: 'wrong-sha256',
        },
      ]),
      /changed before Undo could be recorded/,
    );

    assert.strictEqual(await readFile(previousFilePath, 'utf8'), 'original');
    assert.strictEqual(await readFile(manifestPath, 'utf8'), '{"operation":"test"}');
    await assert.rejects(access(generatedArtifactPath));
  });
});

async function makeRecordFixture(
  workspacePath: string,
  name: string,
): Promise<ConversionOutput & { previousFilePath: string }> {
  const stagingRootPath = path.join(workspacePath, '.graphics-workbench', name);
  const outputPath = path.join(workspacePath, `${name}.pdf`);
  const previousFilePath = path.join(stagingRootPath, `${name}.previous`);
  await writeFixture(outputPath, `generated-${name}`);
  await writeFixture(previousFilePath, `original-${name}`);
  return { outputPath, workspacePath, previousFilePath, stagingRootPath };
}

async function writeFixture(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}
