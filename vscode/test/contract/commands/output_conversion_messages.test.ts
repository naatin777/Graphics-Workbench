import assert from 'node:assert/strict';

import { createOutputConversionMessages } from '../../../src/commands/lifecycle/run_output_conversion.js';
import { userMessage } from '../../../src/commands/shared/user_messages.js';

suite('出力形式変換コマンドのメッセージ組み立て', () => {
  test('変換形式WebPと入力件数3から、進捗タイトル・準備・成功・キャンセル・失敗・Undo不可の各メッセージを既存のlocale keyに基づいて組み立てる', () => {
    const messages = createOutputConversionMessages('WebP', 3);

    assert.strictEqual(messages.progressTitle, userMessage('message.progress.convertToOutput.title', 3, 'WebP'));
    assert.strictEqual(messages.prepareMessage, userMessage('message.progress.prepareConversion', 'WebP'));
    assert.strictEqual(messages.successMessage(2), userMessage('message.convertToOutput.success', 2, 'WebP'));
    assert.strictEqual(
      messages.undoUnavailableMessage('Converted', 'backup unavailable'),
      userMessage('message.undoUnavailable', 'Converted', 'backup unavailable'),
    );
    assert.strictEqual(messages.cancelledMessage, userMessage('message.convertToOutput.cancelled', 'WebP'));
    assert.strictEqual(
      messages.failedMessage('tool failed'),
      userMessage('message.convertToOutput.failed', 'WebP', 'tool failed'),
    );
  });
});
