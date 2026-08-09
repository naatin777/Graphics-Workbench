import assert from 'node:assert/strict';

import { runPostConversionUi } from '../../src/commands/lifecycle/post_conversion_ui.js';

suite('変換結果commit後の通知・操作失敗を変換失敗から分離する成功後処理', () => {
  test('成功後actionがrejectしても呼び出し元へ再throwせず、変換名と理由をOutput Channelへ記録する', async () => {
    const lines: string[] = [];

    await assert.doesNotReject(
      runPostConversionUi('rotate-pdf-configure', { appendLine: (line) => lines.push(line) }, async () => {
        throw new Error('notification unavailable');
      }),
    );

    assert.deepStrictEqual(lines, ['[rotate-pdf-configure] success notification failed: notification unavailable']);
  });

  test('成功後actionとOutput Channelへの失敗記録が両方throwしても、commit済み変換の失敗として再throwしない', async () => {
    await assert.doesNotReject(
      runPostConversionUi(
        'split-pdf-configure',
        {
          appendLine: () => {
            throw new Error('output channel disposed');
          },
        },
        async () => {
          throw new Error('notification unavailable');
        },
      ),
    );
  });
});
