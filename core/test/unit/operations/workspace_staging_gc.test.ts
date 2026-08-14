import assert from 'node:assert/strict';
import { mkdir, mkdtempDisposable, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { cleanupStaleWorkspaceStagingRoots, markStagingRootOwned } from '@graphics-workbench/core/runtime';

describe('workspace staging GC', () => {
  it('ownerプロセスが生きているstaging rootは保持し、死亡・マーカーなしのrootは削除する', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staging-gc-'));

    const liveRun = path.join(workspace.path, '.graphics-workbench', 'compress-image', 'live-run');
    const deadRun = path.join(workspace.path, '.graphics-workbench', 'compress-image', 'dead-run');
    const unmarkedRun = path.join(workspace.path, '.graphics-workbench', 'convert-png', 'old-run');
    const backupPath = path.join(deadRun, '1', 'result.png.previous');
    await markStagingRootOwned(liveRun);
    await mkdir(path.join(liveRun, '1'), { recursive: true });
    await writeFile(path.join(liveRun, '1', 'result.png'), 'staged');
    await markStagingRootOwned(deadRun);
    await writeFile(
      path.join(deadRun, '.graphics-workbench-owner'),
      `${JSON.stringify({ pid: 2_147_483_647 })}\n`,
      'utf8',
    );
    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(backupPath, 'previous bytes');
    await mkdir(unmarkedRun, { recursive: true });
    await writeFile(path.join(unmarkedRun, 'result.png'), 'old');

    await cleanupStaleWorkspaceStagingRoots(workspace.path);

    assert.strictEqual(await pathExists(path.join(liveRun, '1', 'result.png')), true);
    assert.strictEqual(await pathExists(backupPath), false);
    assert.strictEqual(await pathExists(unmarkedRun), false);
    assert.deepStrictEqual(await readdir(path.join(workspace.path, '.graphics-workbench', 'compress-image')), [
      'live-run',
    ]);
    assert.deepStrictEqual(await readdir(path.join(workspace.path, '.graphics-workbench')), ['compress-image']);
  });

  it('死んだPIDのマーカーは削除対象、自プロセスPIDのマーカーは保持対象と判定する', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staging-gc-pid-'));

    const deadRun = path.join(workspace.path, '.graphics-workbench', 'crop-pdf', 'dead-run');
    await markStagingRootOwned(deadRun);
    const markerPath = path.join(deadRun, '.graphics-workbench-owner');
    await writeFile(markerPath, `${JSON.stringify({ pid: 2_147_483_647 })}\n`, 'utf8');

    const selfRun = path.join(workspace.path, '.graphics-workbench', 'crop-pdf', 'self-run');
    await markStagingRootOwned(selfRun);
    const selfMarkerPath = path.join(selfRun, '.graphics-workbench-owner');
    assert.strictEqual(await readFile(selfMarkerPath, 'utf8'), `${JSON.stringify({ pid: process.pid })}\n`);

    await cleanupStaleWorkspaceStagingRoots(workspace.path);

    assert.strictEqual(await pathExists(deadRun), false);
    assert.strictEqual(await pathExists(selfRun), true);
    assert.strictEqual(await pathExists(selfMarkerPath), true);
  });

  it('workspaceに.graphics-workbenchが無い場合は何もせず成功する', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staging-gc-empty-'));
    await cleanupStaleWorkspaceStagingRoots(workspace.path);
    assert.strictEqual(await pathExists(path.join(workspace.path, '.graphics-workbench')), false);
  });

  it('markStagingRootOwnedはrootを作成して自プロセスPIDのマーカーを書く', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staging-gc-mark-'));

    const rootPath = path.join(workspace.path, '.graphics-workbench', 'merge-pdf', 'run-1');
    await markStagingRootOwned(rootPath);

    assert.strictEqual(
      await readFile(path.join(rootPath, '.graphics-workbench-owner'), 'utf8'),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
    await rm(rootPath, { recursive: true, force: true });
  });
});

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
