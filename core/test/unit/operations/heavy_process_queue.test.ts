/* oxlint-disable typescript/no-invalid-void-type -- Promise.withResolvers requires a type argument; void expresses the intended signal. */
import assert from 'node:assert/strict';

import PQueue from 'p-queue';

import { runHeavyProcess, enqueueHeavyProcess } from '@graphics-workbench/core/external-tools';

describe('重処理の共有実行キュー（p-queue）', () => {
  it('同時実行数を1にしたキューで先頭タスクの実行中に待機させた2件目をキャンセルすると、開始前にキャンセルとしてrejectされ、先頭の完了後も2件目のタスク本体は実行されない', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const first = queue.add(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    }, {});
    await firstStarted.promise;

    let secondStarted = false;
    const abortController = new AbortController();
    const second = queue.add(
      async () => {
        secondStarted = true;
      },
      { signal: abortController.signal },
    );

    abortController.abort();
    await assert.rejects(second, { name: 'AbortError' });
    releaseFirst.resolve();
    await first;
    assert.strictEqual(secondStarted, false);
  });

  it('同時実行数を1にしたキューで先頭タスクが失敗しても、その後に待機していた後続タスクが開始されて実行結果を返す', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const failed = queue.add(async () => {
      throw new Error('first failed');
    }, {});
    const completed = queue.add(async () => 'completed', {});

    await assert.rejects(failed, /first failed/iu);
    assert.strictEqual(await completed, 'completed');
  });

  it('concurrencyを増やすと待機中のtaskが追加slotで開始され、実行中taskはそのまま継続する', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const first = queue.add(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    }, {});
    await firstStarted.promise;

    let secondStarted = false;
    const second = queue.add(async () => {
      secondStarted = true;
    }, {});
    // concurrency 1のslotはfirstが占有しているため、secondは未開始で確定する。
    assert.strictEqual(secondStarted, false);
    queue.concurrency = 2;
    await second;
    assert.strictEqual(secondStarted, true);

    releaseFirst.resolve();
    await first;
  });

  it('concurrencyを下げても実行中taskは継続し、新しいtaskは実行中slotが空くまで待機する', async () => {
    const queue = new PQueue({ concurrency: 2 });
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const releaseSecond = Promise.withResolvers<void>();
    const first = queue.add(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    }, {});
    const second = queue.add(async () => {
      secondStarted.resolve();
      await releaseSecond.promise;
    }, {});
    await Promise.all([firstStarted.promise, secondStarted.promise]);

    let thirdStarted = false;
    const third = queue.add(async () => {
      thirdStarted = true;
    }, {});

    queue.concurrency = 1;
    releaseFirst.resolve();
    await first;
    // secondがslotを占有しているため、thirdは未開始で確定する。
    assert.strictEqual(thirdStarted, false);

    releaseSecond.resolve();
    await Promise.all([second, third]);
    assert.strictEqual(thirdStarted, true);
  });

  it('実行開始後にsignalがabortするとadd()はそのreasonでrejectされるが、task本体は中断されず最後まで実行される', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const abortController = new AbortController();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    let completed = false;
    const running = queue.add(
      async () => {
        started.resolve();
        await finished.promise;
        completed = true;
        return 'completed';
      },
      { signal: abortController.signal },
    );
    await started.promise;

    abortController.abort();
    await assert.rejects(running, { name: 'AbortError' });
    finished.resolve();
    await Promise.resolve();
    assert.strictEqual(completed, true);
  });

  it('shutdown相当（AbortController.abort）は待機中taskだけをキャンセルし、実行中taskの完了を妨げず、以後のtaskを拒否する', async () => {
    const queue = new PQueue({ concurrency: 1 });
    const shutdownController = new AbortController();

    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const first = queue.add(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    }, {});
    await firstStarted.promise;

    let queuedStarted = false;
    const queued = enqueueHeavyProcess(queue, shutdownController.signal, async () => {
      queuedStarted = true;
    });

    shutdownController.abort();
    await assert.rejects(queued, { name: 'AbortError' });
    assert.strictEqual(queuedStarted, false);

    const rejected = enqueueHeavyProcess(queue, shutdownController.signal, async () => 'never');
    await assert.rejects(rejected, /Heavy process queue was stopped/u);

    releaseFirst.resolve();
    await first;
  });

  it('runHeavyProcessはabort済みsignalで開始前にOperationCancelledErrorで失敗し、タスク本体を実行しない', async () => {
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

  it('runHeavyProcessはsignalなしでも正常に実行して結果を返す', async () => {
    assert.strictEqual(await runHeavyProcess(async () => 'value'), 'value');
  });

  it('実行開始後にsignalがabortしても、runHeavyProcessは実taskの完了を待って成功結果を返す（abort reasonで即rejectしない）', async () => {
    const abortController = new AbortController();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const running = runHeavyProcess(async () => {
      started.resolve();
      await finished.promise;
      return 'completed';
    }, abortController.signal);
    await started.promise;

    abortController.abort();
    finished.resolve();
    assert.strictEqual(await running, 'completed');
  });

  it('実行開始後にsignalがabortしても、runHeavyProcessは実task自身の失敗reasonでrejectする（abort reasonに置き換えない）', async () => {
    const abortController = new AbortController();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const running = runHeavyProcess(async () => {
      started.resolve();
      await finished.promise;
      throw new Error('task failure');
    }, abortController.signal);
    await started.promise;

    abortController.abort();
    finished.resolve();
    await assert.rejects(running, /task failure/u);
  });

  it('実行開始後にsignalがabortしてtaskがsignalを自ら観測した場合は、実taskのOperationCancelledErrorでrejectする', async () => {
    const abortController = new AbortController();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const running = runHeavyProcess(async () => {
      started.resolve();
      await finished.promise;
      abortController.signal.throwIfAborted();
      return 'completed';
    }, abortController.signal);
    await started.promise;

    abortController.abort();
    finished.resolve();
    await assert.rejects(running, { name: 'AbortError' });
  });
});
