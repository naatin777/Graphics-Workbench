import assert from 'node:assert/strict';

import PQueue from 'p-queue';

import { runHeavyProcess } from '@graphics-workbench/core/external-tools';

suite('重処理の共有実行キュー（p-queue）', () => {
  test('同時実行数を1にしたキューで先頭タスクの実行中に待機させた2件目をキャンセルすると、開始前にキャンセルとしてrejectされ、先頭の完了後も2件目のタスク本体は実行されない', async () => {
    const queue = new PQueue({ concurrency: 1 });
    let releaseFirst!: () => void;
    let secondStarted = false;
    const first = queue.add(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
      {},
    );
    const abortController = new AbortController();
    const second = queue.add(
      async () => {
        secondStarted = true;
      },
      { signal: abortController.signal },
    );

    abortController.abort();
    await assert.rejects(second, { name: 'AbortError' });
    releaseFirst();
    await first;
    assert.strictEqual(secondStarted, false);
  });

  test('同時実行数を1にしたキューで先頭タスクが失敗しても、その後に待機していた後続タスクが開始されて実行結果を返す', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const failed = queue.add(async () => {
      throw new Error('first failed');
    }, {});
    const completed = queue.add(async () => 'completed', {});

    await assert.rejects(failed, /first failed/iu);
    assert.strictEqual(await completed, 'completed');
  });

  test('concurrencyを増やすと待機中のtaskが追加slotで開始され、実行中taskはそのまま継続する', async () => {
    const queue = new PQueue({ concurrency: 1 });
    let releaseFirst!: () => void;
    const first = queue.add(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
      {},
    );
    let secondStarted = false;
    const second = queue.add(async () => {
      secondStarted = true;
    }, {});

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(secondStarted, false);
    queue.concurrency = 2;
    await second;
    assert.strictEqual(secondStarted, true);

    releaseFirst();
    await first;
  });

  test('concurrencyを下げても実行中taskは継続し、新しいtaskは実行中slotが空くまで待機する', async () => {
    const queue = new PQueue({ concurrency: 2 });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = queue.add(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
      {},
    );
    const second = queue.add(
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve;
        }),
      {},
    );
    let thirdStarted = false;
    const third = queue.add(async () => {
      thirdStarted = true;
    }, {});

    await new Promise<void>((resolve) => setImmediate(resolve));
    queue.concurrency = 1;
    releaseFirst();
    await first;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(thirdStarted, false);

    releaseSecond();
    await Promise.all([second, third]);
    assert.strictEqual(thirdStarted, true);
  });

  test('実行開始後にsignalがabortするとadd()はそのreasonでrejectされるが、task本体は中断されず最後まで実行される', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const abortController = new AbortController();
    let completed = false;
    const running = queue.add(
      async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        completed = true;
        return 'completed';
      },
      { signal: abortController.signal },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    abortController.abort();
    await assert.rejects(running, { name: 'AbortError' });
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    assert.strictEqual(completed, true);
  });

  test('shutdown相当（AbortController.abort）は待機中taskだけをキャンセルし、実行中taskの完了を妨げず、以後のtaskを拒否する', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const shutdownController = new AbortController();
    const combined = (signal?: AbortSignal): AbortSignal =>
      signal === undefined ? shutdownController.signal : AbortSignal.any([signal, shutdownController.signal]);

    let releaseFirst!: () => void;
    const first = queue.add(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
      {},
    );
    let queuedStarted = false;
    const queued = queue.add(
      async () => {
        queuedStarted = true;
      },
      { signal: combined() },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    shutdownController.abort();
    await assert.rejects(queued, { name: 'AbortError' });
    assert.strictEqual(queuedStarted, false);

    const rejected = queue.add(async () => 'never', { signal: combined() });
    await assert.rejects(rejected, { name: 'AbortError' });

    releaseFirst();
    await first;
  });

  test('runHeavyProcessはabort済みsignalで開始前にOperationCancelledErrorで失敗し、タスク本体を実行しない', async () => {
    const abortController = new AbortController();
    abortController.abort();
    let started = false;

    await assert.rejects(
      runHeavyProcess(async () => {
        started = true;
      }, abortController.signal),
      /cancelled before it started/iu,
    );
    assert.strictEqual(started, false);
  });

  test('runHeavyProcessはsignalなしでも正常に実行して結果を返す', async () => {
    assert.strictEqual(await runHeavyProcess(async () => 'value'), 'value');
  });
});
