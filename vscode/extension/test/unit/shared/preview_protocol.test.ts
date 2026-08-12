import assert from 'node:assert/strict';

import { isPreviewWebviewToHostMessage } from '../../../../protocol/protocols/preview_protocol.js';

suite('PDF/TIFF previewのWebview操作メッセージの受信判定（ready/renderPage/previewLoadFailed）', () => {
  test('readyとcancelを余分なキーなしで受け入れる', () => {
    assert.equal(isPreviewWebviewToHostMessage({ type: 'ready' }), true);
    assert.equal(isPreviewWebviewToHostMessage({ type: 'cancel' }), true);
  });

  test('正の整数pageを持つrenderPageを受け入れ、0・負数・小数・文字列のpageは拒否する', () => {
    assert.equal(isPreviewWebviewToHostMessage({ type: 'renderPage', payload: { page: 1 } }), true);
    assert.equal(isPreviewWebviewToHostMessage({ type: 'renderPage', payload: { page: 0 } }), false);
    assert.equal(isPreviewWebviewToHostMessage({ type: 'renderPage', payload: { page: -1 } }), false);
    assert.equal(isPreviewWebviewToHostMessage({ type: 'renderPage', payload: { page: 1.5 } }), false);
    assert.equal(isPreviewWebviewToHostMessage({ type: 'renderPage', payload: { page: '1' } }), false);
  });

  test('messageを持つpreviewLoadFailedを受け入れ、message以外のkey・payloadの欠落・typeの空文字を拒否する', () => {
    assert.equal(isPreviewWebviewToHostMessage({ type: 'previewLoadFailed', payload: { message: 'failed' } }), true);
    assert.equal(
      isPreviewWebviewToHostMessage({ type: 'previewLoadFailed', payload: { message: 'failed', code: 'E_FAIL' } }),
      false,
    );
    assert.equal(isPreviewWebviewToHostMessage({ type: 'previewLoadFailed' }), false);
    assert.equal(isPreviewWebviewToHostMessage({ type: '' }), false);
  });

  test('unknown type・payload不足・余分なトップレベルキーを拒否する', () => {
    assert.equal(isPreviewWebviewToHostMessage({ type: 'unknown' }), false);
    assert.equal(isPreviewWebviewToHostMessage({ type: 'renderPage' }), false);
    assert.equal(isPreviewWebviewToHostMessage({ type: 'ready', requestId: 'request-1' }), false);
  });
});
