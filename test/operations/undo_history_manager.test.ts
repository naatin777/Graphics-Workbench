// Test target:
// - Undo履歴が上限を超えると最も古いrecordのバックアップが削除されること
// - 保存期間を過ぎたrecordは次回のrecord/undoで追い出されること
// - workspaceStateのマニフェストへ記録され、起動時initializeで期限切れの孤立データが削除されること
// - 保存期限内のマニフェスト記録は起動時initで削除されないこと
//
// Mocked:
// - workspaceState相当のkey-value storage
//
// Not tested:
// - VS Codeの通知UI
// - command登録
// - Undo時のハッシュ検証・ロールバック（既存のundo_last_conversionテストが対象）

import assert from 'node:assert/strict';
import { access, mkdir, mkdtempDisposable, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  UndoHistoryManager,
  UNDO_HISTORY_MANIFEST_KEY,
  type UndoManifestStorage,
} from '../../src/operations/lifecycle/undo_history_manager.js';
import type { ConversionOutput } from '../../src/operations/lifecycle/undo_last_conversion.js';

suite('Undo用に保存した変換前バックアップの記録と期限管理', () => {
  test('履歴上限2を超えて3つ目の変換履歴を追加すると、最も古い変換履歴のバックアップだけを削除して残り2つを保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const manager = new UndoHistoryManager({ maxRecords: 2, now: () => 0 });

    const first = await makeRecordFixture(workspacePath.path, 'first');
    const second = await makeRecordFixture(workspacePath.path, 'second');
    await manager.record([first]);
    await manager.record([second]);
    await assert.doesNotReject(access(first.previousFilePath));

    const third = await makeRecordFixture(workspacePath.path, 'third');
    await manager.record([third]);

    await assert.rejects(access(first.previousFilePath));
    await assert.doesNotReject(access(second.previousFilePath));
    await assert.doesNotReject(access(third.previousFilePath));
  });

  test('workspace外の機密PDF用rootにある上書き前バックアップをUndo履歴へ記録すると、生成artifactだけを削除してバックアップとmanifestを保持し、Undo後は元内容を復元してroot全体を削除する', async () => {
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
    const manager = new UndoHistoryManager({ now: () => 0 });

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

    assert.strictEqual(await manager.undo(recordId), 'done');
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
    await assert.rejects(access(stagingRoot.path));
  });

  test('保存期間1000msを過ぎた変換履歴は次の変換履歴追加時に追い出してバックアップを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    let currentTime = 0;
    const manager = new UndoHistoryManager({ maxRecords: 10, retentionMs: 1000, now: () => currentTime });

    const first = await makeRecordFixture(workspacePath.path, 'first');
    await manager.record([first]);

    currentTime = 2000;
    const second = await makeRecordFixture(workspacePath.path, 'second');
    await manager.record([second]);

    await assert.rejects(access(first.previousFilePath));
    await assert.doesNotReject(access(second.previousFilePath));
  });

  test('変換履歴をマニフェストへ記録し、再起動時初期化で保存期間を過ぎた変換履歴のバックアップを削除してマニフェストからも除去する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    const first = await makeRecordFixture(workspacePath.path, 'first');
    const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await manager.record([first]);
    assert.strictEqual(readManifestEntries(storage).length, 1);

    currentTime = 5000;
    const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await restarted.initialize();

    await assert.rejects(access(first.previousFilePath));
    assert.strictEqual(readManifestEntries(storage).length, 0);
  });

  test('保存期限内の保存先記録は再起動時初期化で削除せずバックアップも保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    const first = await makeRecordFixture(workspacePath.path, 'first');
    const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await manager.record([first]);

    currentTime = 500;
    const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await restarted.initialize();

    await assert.doesNotReject(access(first.previousFilePath));
    assert.strictEqual(readManifestEntries(storage).length, 1);
  });

  test('保存期限を過ぎたmanifestのrootがworkspace外を指すsymlinkへ差し替えられcleanupを拒否された場合は、失敗したrootの記録をmanifestへ残して次回初期化で再試行可能にする', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-outside-'));
    const rootPath = path.join(workspacePath.path, 'stale-root');
    await symlink(outsidePath.path, rootPath);
    const storage = new MemoryManifestStorage();
    await storage.update(UNDO_HISTORY_MANIFEST_KEY, {
      version: 1,
      entries: [
        {
          id: 'stale-record',
          createdAt: 0,
          roots: [{ workspacePath: workspacePath.path, rootPath }],
        },
      ],
    });
    const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => 5000 });

    await manager.initialize();

    assert.strictEqual(readManifestEntries(storage).length, 1);
    await assert.doesNotReject(access(rootPath));
    await assert.doesNotReject(access(outsidePath.path));
  });

  test('再起動後に新しい変換履歴を追加しても、保存期限内の孤立保存先記録のバックアップは保持してマニフェストに2件記録する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    const first = await makeRecordFixture(workspacePath.path, 'first');
    const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await manager.record([first]);

    currentTime = 500;
    const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await restarted.initialize();

    const second = await makeRecordFixture(workspacePath.path, 'second');
    await restarted.record([second]);

    await assert.doesNotReject(access(first.previousFilePath));
    await assert.doesNotReject(access(second.previousFilePath));
    assert.strictEqual(readManifestEntries(storage).length, 2);
  });

  test('再起動後に保存期間を過ぎた孤立保存先記録は次の変換履歴追加時にバックアップとマニフェストから削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    const first = await makeRecordFixture(workspacePath.path, 'first');
    const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await manager.record([first]);

    currentTime = 500;
    const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
    await restarted.initialize();
    assert.strictEqual(readManifestEntries(storage).length, 1);

    currentTime = 2000;
    const second = await makeRecordFixture(workspacePath.path, 'second');
    await restarted.record([second]);

    await assert.rejects(access(first.previousFilePath));
    await assert.doesNotReject(access(second.previousFilePath));
    assert.strictEqual(readManifestEntries(storage).length, 1);
  });

  test('Undoが成功した後は、変換前バックアップの記録をマニフェストから除去してバックアップファイルも削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    const manager = new UndoHistoryManager({ storage, now: () => 0 });

    const first = await makeRecordFixture(workspacePath.path, 'first');
    const recordId = await manager.record([first]);
    assert.strictEqual(readManifestEntries(storage).length, 1);

    const outcome = await manager.undo(recordId);
    assert.strictEqual(outcome, 'done');
    assert.strictEqual(readManifestEntries(storage).length, 0);
    await assert.rejects(access(first.previousFilePath));
  });

  test('変換履歴が1件も記録されていない状態でundoを呼ぶと、何もせず『履歴なし』の結果を返す', async () => {
    const manager = new UndoHistoryManager();
    assert.strictEqual(await manager.undo(), 'no-record');
  });

  test('2件目の変換を記録した後に1件目の変換履歴のidを指定してundoを試みると、最新の変換履歴と不一致のため変換を元に戻さず『新しい変換が先行』の結果を返す', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-undo-history-workspace-'));
    const manager = new UndoHistoryManager({ now: () => 0 });

    const firstRecordId = await manager.record([await makeRecordFixture(workspacePath.path, 'first')]);
    await manager.record([await makeRecordFixture(workspacePath.path, 'second')]);

    assert.strictEqual(await manager.undo(firstRecordId), 'newer-conversion');
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

function readManifestEntries(storage: MemoryManifestStorage): unknown[] {
  const value = storage.get(UNDO_HISTORY_MANIFEST_KEY);

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  const candidate = value as { entries?: unknown };

  if (!Array.isArray(candidate.entries)) {
    return [];
  }

  return candidate.entries;
}

class MemoryManifestStorage implements UndoManifestStorage {
  readonly #values = new Map<string, unknown>();

  get(key: string): unknown {
    return this.#values.get(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    this.#values.set(key, value);
  }
}
