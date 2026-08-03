import assert from 'node:assert/strict';

import { HeavyProcessLimiter } from '../../src/operations/external_tools/heavy_process_limiter.js';

suite('共有重処理キュー', () => {
  test('同時実行数を共有し、待機中のキャンセルで開始しない', async () => {
    const limiter = new HeavyProcessLimiter(1);
    let releaseFirst!: () => void;
    let secondStarted = false;
    const first = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const abortController = new AbortController();
    const second = limiter.run(async () => {
      secondStarted = true;
    }, abortController.signal);

    abortController.abort();
    await assert.rejects(second, /cancelled before it started/iu);
    releaseFirst();
    await first;
    assert.strictEqual(secondStarted, false);
  });

  test('先行タスクの失敗後も後続タスクを実行する', async () => {
    const limiter = new HeavyProcessLimiter(1);
    const failed = limiter.run(async () => {
      throw new Error('first failed');
    });
    const completed = limiter.run(async () => 'completed');

    await assert.rejects(failed, /first failed/iu);
    assert.strictEqual(await completed, 'completed');
  });
});
