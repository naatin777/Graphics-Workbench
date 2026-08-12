import assert from 'node:assert/strict';
import { access, readFile, stat, writeFile } from 'node:fs/promises';

import {
  cleanupStaleSecurePdfStagingRoots,
  createSecurePdfStagingRoot,
} from '../../../src/operations/lifecycle/secure_staging.js';
import { isRecord } from '../../../src/shared/protocols/protocol_utils.js';

suite('機密PDFの中間ディレクトリを作成し、heartbeatから保存期間を判定して掃除する', () => {
  test('作成直後のrootは維持し、不在PIDを記録した24時間超過のold rootだけを削除する', async () => {
    const activeRoot = await createSecurePdfStagingRoot('test-active');
    const oldRoot = await createSecurePdfStagingRoot('test-old');
    const oldManifest = JSON.parse(await readFile(`${oldRoot}/manifest.json`, 'utf8'));
    const staleAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await writeFile(
      `${oldRoot}/manifest.json`,
      JSON.stringify({ ...oldManifest, pid: Number.MAX_SAFE_INTEGER, startedAt: staleAt, updatedAt: staleAt }),
    );

    try {
      if (process.platform !== 'win32') {
        assert.equal((await stat(activeRoot)).mode & 0o777, 0o700);
        assert.equal((await stat(`${activeRoot}/manifest.json`)).mode & 0o777, 0o600);
      }
      const parsedManifest: unknown = JSON.parse(await readFile(`${activeRoot}/manifest.json`, 'utf8'));
      assert.ok(isRecord(parsedManifest));
      const manifest = parsedManifest;
      assert.equal(typeof manifest.sessionId, 'string');
      assert.equal(typeof manifest.extensionHostStartedAt, 'number');
      assert.equal(typeof manifest.updatedAt, 'number');
      assert.equal(typeof manifest.operationId, 'string');
      await cleanupStaleSecurePdfStagingRoots(Date.now());
      await access(activeRoot);
      await assert.rejects(access(oldRoot));
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(activeRoot, { recursive: true, force: true });
      await rm(oldRoot, { recursive: true, force: true });
    }
  });

  test('24時間を超えたrootはPIDが現在も存在していてもheartbeatが古ければ削除する', async () => {
    const staleRoot = await createSecurePdfStagingRoot('test-stale-pid');
    try {
      const manifestPath = `${staleRoot}/manifest.json`;
      const manifestValue: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (!isRecord(manifestValue)) {
        throw new Error('Secure staging manifest is not an object.');
      }
      const manifest = manifestValue;
      const staleAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, pid: process.pid, startedAt: staleAt, updatedAt: staleAt }),
      );

      await cleanupStaleSecurePdfStagingRoots(Date.now());
      await assert.rejects(access(staleRoot));
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(staleRoot, { recursive: true, force: true });
    }
  });
});
