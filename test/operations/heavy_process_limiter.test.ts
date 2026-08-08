import assert from 'node:assert/strict';

import { HeavyProcessLimiter } from '../../src/operations/external_tools/heavy_process_limiter.js';

suite('重処理の共有実行キュー', () => {
  test('同時実行数を1にしたリミッタで先頭タスクの実行中に待機させた2件目をキャンセルすると、開始前にキャンセルとしてrejectされ、先頭の完了後も2件目のタスク本体は実行されない', async () => {
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

  test('同時実行数を1にしたリミッタで先頭タスクが失敗しても、その後に待機していた後続タスクが開始されて実行結果を返す', async () => {
    const limiter = new HeavyProcessLimiter(1);
    const failed = limiter.run(async () => {
      throw new Error('first failed');
    });
    const completed = limiter.run(async () => 'completed');

    await assert.rejects(failed, /first failed/iu);
    assert.strictEqual(await completed, 'completed');
  });
});
