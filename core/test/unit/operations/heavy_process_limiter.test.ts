import assert from 'node:assert/strict';

import { HeavyProcessLimiter } from '@graphics-workbench/core/external-tools';

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

  test('concurrencyを増やすと待機中のtaskが追加slotで開始され、実行中taskはそのまま継続する', async () => {
    const limiter = new HeavyProcessLimiter(1);
    let releaseFirst!: () => void;
    const first = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    let secondStarted = false;
    const second = limiter.run(async () => {
      secondStarted = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(secondStarted, false);
    limiter.setConcurrency(2);
    await second;
    assert.strictEqual(secondStarted, true);

    releaseFirst();
    await first;
  });

  test('concurrencyを下げても実行中taskは継続し、新しいtaskは実行中slotが空くまで待機する', async () => {
    const limiter = new HeavyProcessLimiter(2);
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve;
        }),
    );
    let thirdStarted = false;
    const third = limiter.run(async () => {
      thirdStarted = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    limiter.setConcurrency(1);
    releaseFirst();
    await first;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(thirdStarted, false);

    releaseSecond();
    await Promise.all([second, third]);
    assert.strictEqual(thirdStarted, true);
  });

  test('実行開始後のAbortSignalはtask本体を中断せず、完了結果を返す', async () => {
    const limiter = new HeavyProcessLimiter(1);
    const abortController = new AbortController();
    let release!: () => void;
    const running = limiter.run(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('completed');
        }),
      abortController.signal,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    abortController.abort();
    release();
    assert.strictEqual(await running, 'completed');
  });

  test('同じlimiter内から開始したnested taskは新しいslotを待たず、外部toolを含む1つの重処理として実行される', async () => {
    const limiter = new HeavyProcessLimiter(1);
    let nestedStarted = false;

    await limiter.run(async () => {
      await limiter.run(async () => {
        nestedStarted = true;
      });
    });

    assert.strictEqual(nestedStarted, true);
  });

  test('stopは待機中taskだけをキャンセルし、実行中taskの完了を妨げず、以後のtaskを拒否する', async () => {
    const limiter = new HeavyProcessLimiter(1);
    let releaseFirst!: () => void;
    const first = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    let queuedStarted = false;
    const queued = limiter.run(async () => {
      queuedStarted = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    limiter.stop();
    await assert.rejects(queued, /queue was stopped|cancelled before it started/iu);
    assert.strictEqual(queuedStarted, false);

    releaseFirst();
    await first;
    await assert.rejects(
      limiter.run(async () => undefined),
      /queue was stopped/iu,
    );
  });
});
