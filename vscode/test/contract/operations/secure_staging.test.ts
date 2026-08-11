import assert from 'node:assert/strict';
import { access, readFile, stat, writeFile } from 'node:fs/promises';

import {
  cleanupStaleSecurePdfStagingRoots,
  createSecurePdfStagingRoot,
} from '../../../src/operations/lifecycle/secure_staging.js';
import { isRecord } from '../../../src/shared/protocols/protocol_utils.js';

suite('機密PDFの中間ディレクトリを作成し、保存期間を過ぎた古い中間ディレクトリを掃除する', () => {
  test('現プロセスのactive rootは8日後のactivation cleanupでも維持し、不在PIDを記録した24時間超過のold rootだけを削除する', async () => {
    const activeRoot = await createSecurePdfStagingRoot('test-active');
    const oldRoot = await createSecurePdfStagingRoot('test-old');
    await writeFile(
      `${oldRoot}/manifest.json`,
      JSON.stringify({
        pid: Number.MAX_SAFE_INTEGER,
        startedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        operation: 'test-old',
      }),
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

      await cleanupStaleSecurePdfStagingRoots(Date.now() + 2 * 24 * 60 * 60 * 1000);
      await access(activeRoot);
      await cleanupStaleSecurePdfStagingRoots(Date.now() + 8 * 24 * 60 * 60 * 1000);
      await access(activeRoot);
      await assert.rejects(access(oldRoot));
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(activeRoot, { recursive: true, force: true });
      await rm(oldRoot, { recursive: true, force: true });
    }
  });
});
