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
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  UndoHistoryManager,
  UNDO_HISTORY_MANIFEST_KEY,
  type UndoManifestStorage,
} from '../../src/operations/lifecycle/undo_history_manager.js';
import type { ConversionOutput } from '../../src/operations/lifecycle/undo_last_conversion.js';

suite('Undo履歴のライフサイクル管理', () => {
  test('履歴が上限を超えると最も古いrecordのバックアップを削除する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    const manager = new UndoHistoryManager({ maxRecords: 2, now: () => 0 });

    try {
      const first = await makeRecordFixture(workspacePath, 'first');
      const second = await makeRecordFixture(workspacePath, 'second');
      await manager.record([first]);
      await manager.record([second]);
      await assert.doesNotReject(access(first.previousFilePath));

      const third = await makeRecordFixture(workspacePath, 'third');
      await manager.record([third]);

      await assert.rejects(access(first.previousFilePath));
      await assert.doesNotReject(access(second.previousFilePath));
      await assert.doesNotReject(access(third.previousFilePath));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('保存期間を過ぎたrecordは次のrecord時に追い出してバックアップを削除する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    let currentTime = 0;
    const manager = new UndoHistoryManager({ maxRecords: 10, retentionMs: 1000, now: () => currentTime });

    try {
      const first = await makeRecordFixture(workspacePath, 'first');
      await manager.record([first]);

      currentTime = 2000;
      const second = await makeRecordFixture(workspacePath, 'second');
      await manager.record([second]);

      await assert.rejects(access(first.previousFilePath));
      await assert.doesNotReject(access(second.previousFilePath));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('マニフェストへ記録し、起動時initializeで保存期間を過ぎた孤立データを削除する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    try {
      const first = await makeRecordFixture(workspacePath, 'first');
      const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await manager.record([first]);
      assert.strictEqual(readManifestEntries(storage).length, 1);

      currentTime = 5000;
      const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await restarted.initialize();

      await assert.rejects(access(first.previousFilePath));
      assert.strictEqual(readManifestEntries(storage).length, 0);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('保存期限内のマニフェスト記録は起動時initializeで削除しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    try {
      const first = await makeRecordFixture(workspacePath, 'first');
      const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await manager.record([first]);

      currentTime = 500;
      const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await restarted.initialize();

      await assert.doesNotReject(access(first.previousFilePath));
      assert.strictEqual(readManifestEntries(storage).length, 1);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('再起動後の新しいrecordで期限内の孤立マニフェスト記録を保持する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    try {
      const first = await makeRecordFixture(workspacePath, 'first');
      const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await manager.record([first]);

      currentTime = 500;
      const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await restarted.initialize();

      const second = await makeRecordFixture(workspacePath, 'second');
      await restarted.record([second]);

      await assert.doesNotReject(access(first.previousFilePath));
      await assert.doesNotReject(access(second.previousFilePath));
      assert.strictEqual(readManifestEntries(storage).length, 2);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('再起動後に期限切れになった孤立マニフェスト記録は次のrecordで削除する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    let currentTime = 0;

    try {
      const first = await makeRecordFixture(workspacePath, 'first');
      const manager = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await manager.record([first]);

      currentTime = 500;
      const restarted = new UndoHistoryManager({ storage, retentionMs: 1000, now: () => currentTime });
      await restarted.initialize();
      assert.strictEqual(readManifestEntries(storage).length, 1);

      currentTime = 2000;
      const second = await makeRecordFixture(workspacePath, 'second');
      await restarted.record([second]);

      await assert.rejects(access(first.previousFilePath));
      await assert.doesNotReject(access(second.previousFilePath));
      assert.strictEqual(readManifestEntries(storage).length, 1);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('Undo成功後にrecordをマニフェストからも除去し、バックアップを削除する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    const storage = new MemoryManifestStorage();
    const manager = new UndoHistoryManager({ storage, now: () => 0 });

    try {
      const first = await makeRecordFixture(workspacePath, 'first');
      const recordId = await manager.record([first]);
      assert.strictEqual(readManifestEntries(storage).length, 1);

      const outcome = await manager.undo(recordId);
      assert.strictEqual(outcome, 'done');
      assert.strictEqual(readManifestEntries(storage).length, 0);
      await assert.rejects(access(first.previousFilePath));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('履歴が空のときundoはno-recordを返す', async () => {
    const manager = new UndoHistoryManager();
    assert.strictEqual(await manager.undo(), 'no-record');
  });

  test('新しい変換後に古いrecordをundoしようとするとnewer-conversionを返す', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-undo-history-workspace-'));
    const manager = new UndoHistoryManager({ now: () => 0 });

    try {
      const firstRecordId = await manager.record([await makeRecordFixture(workspacePath, 'first')]);
      await manager.record([await makeRecordFixture(workspacePath, 'second')]);

      assert.strictEqual(await manager.undo(firstRecordId), 'newer-conversion');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
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
