import assert from 'node:assert/strict';
import { access, stat, writeFile } from 'node:fs/promises';

import {
  cleanupStaleSecurePdfStagingRoots,
  createSecurePdfStagingRoot,
} from '../../src/operations/lifecycle/secure_staging.js';

suite('機密PDF staging lifecycle', () => {
  test('active root is preserved and an old root is removed on activation cleanup', async () => {
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
      await cleanupStaleSecurePdfStagingRoots(Date.now());
      await access(activeRoot);

      await cleanupStaleSecurePdfStagingRoots(Date.now() + 2 * 24 * 60 * 60 * 1000);
      await access(activeRoot);
      await assert.rejects(access(oldRoot));
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(activeRoot, { recursive: true, force: true });
      await rm(oldRoot, { recursive: true, force: true });
    }
  });
});
