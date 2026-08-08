import assert from 'node:assert/strict';

import {
  isWebviewEnvelope,
  isWebviewErrorMessage,
  isWebviewMessageWithPayload,
  isWebviewMessageWithoutPayload,
  type WebviewMessage,
} from '../../src/shared/protocols/webview_protocol.js';

suite('Webviewメッセージの共通形式（type・payloadの持ち方）の判定', () => {
  test('typeキーだけを持つreadyメッセージを受け入れ、payloadキーまで持つreadyは共通形式に適合しないため拒否する', () => {
    const ready: WebviewMessage<'ready'> = { type: 'ready' };

    assert.equal(isWebviewEnvelope(ready), true);
    assert.equal(isWebviewMessageWithoutPayload(ready, 'ready'), true);
    assert.equal(isWebviewMessageWithoutPayload({ type: 'ready', payload: {} }, 'ready'), false);
  });

  test('typeとpayloadだけを持ちpayload validator（{id: string}のみ）を満たすapplyを受け入れ、requestId等の余分なトップレベルキーやpayload欠落は拒否する', () => {
    const isApplyPayload = (value: unknown): value is { id: string } => {
      return (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'string' &&
        Object.keys(value).length === 1
      );
    };

    assert.equal(
      isWebviewMessageWithPayload({ type: 'apply', payload: { id: 'job-1' } }, 'apply', isApplyPayload),
      true,
    );
    assert.equal(
      isWebviewMessageWithPayload(
        { type: 'apply', payload: { id: 'job-1' }, requestId: 'request-1' },
        'apply',
        isApplyPayload,
      ),
      false,
    );
    assert.equal(isWebviewMessageWithPayload({ type: 'apply' }, 'apply', isApplyPayload), false);
  });

  test('errorメッセージはpayloadにmessage文字列1つだけを許可し、messageが空文字は受け入れて、code等の余分なキーやmessageが文字列でない場合は拒否する', () => {
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: 'failed' } }), true);
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: '' } }), true);
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: 'failed', code: 'E_FAIL' } }), false);
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: 42 } }), false);
  });

  test('プロトタイプチェーン経由でtypeを持つオブジェクトはtypeキーを直接持っていないため共通形式のメッセージとしてもtypeのみのメッセージとしても受け入れない', () => {
    const message = Object.create({ type: 'ready' });

    assert.strictEqual(isWebviewMessageWithoutPayload(message, 'ready'), false);
    assert.strictEqual(isWebviewEnvelope(message), false);
  });

  test('null・配列・typeが空文字・type以外の余分なキーを持つオブジェクトを共通形式のメッセージとして拒否する', () => {
    assert.equal(isWebviewEnvelope(null), false);
    assert.equal(isWebviewEnvelope([]), false);
    assert.equal(isWebviewEnvelope({ type: '' }), false);
    assert.equal(isWebviewEnvelope({ type: 'ready', extra: true }), false);
  });
});
