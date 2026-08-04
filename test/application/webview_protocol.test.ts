import assert from 'node:assert/strict';

import {
  isWebviewEnvelope,
  isWebviewErrorMessage,
  isWebviewMessageWithPayload,
  isWebviewMessageWithoutPayload,
  type WebviewMessage,
} from '../../src/application/protocols/webview_protocol.js';

suite('共有Webview protocol envelope', () => {
  test('payloadなしのcontrol messageをtype-only envelopeとして受け付ける', () => {
    const ready: WebviewMessage<'ready'> = { type: 'ready' };

    assert.equal(isWebviewEnvelope(ready), true);
    assert.equal(isWebviewMessageWithoutPayload(ready, 'ready'), true);
    assert.equal(isWebviewMessageWithoutPayload({ type: 'ready', payload: {} }, 'ready'), false);
  });

  test('payload付きmessageは指定したpayload validatorとtop-level keyを通過させる', () => {
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

  test('error envelopeはmessageだけをpayloadに許可する', () => {
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: 'failed' } }), true);
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: '' } }), true);
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: 'failed', code: 'E_FAIL' } }), false);
    assert.equal(isWebviewErrorMessage({ type: 'error', payload: { message: 42 } }), false);
  });

  test('envelope以外の値と空のtypeを拒否する', () => {
    assert.equal(isWebviewEnvelope(null), false);
    assert.equal(isWebviewEnvelope([]), false);
    assert.equal(isWebviewEnvelope({ type: '' }), false);
    assert.equal(isWebviewEnvelope({ type: 'ready', extra: true }), false);
  });
});
