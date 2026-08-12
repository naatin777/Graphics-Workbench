import assert from 'node:assert/strict';

import { createProtocolClient, createTestTransport } from '../../../../protocol/protocols/typed_protocol.js';
import { previewProtocol } from '../../../../protocol/protocols/preview_protocol.js';

suite('typed Webview protocol transport', () => {
  test('derives directional senders and validates incoming messages', () => {
    const transport = createTestTransport();
    const webview = createProtocolClient(previewProtocol, transport, 'webviewToHost');
    const host = createProtocolClient(previewProtocol, transport, 'hostToWebview');
    const received: string[] = [];

    const unsubscribe = host.on({
      error: (payload) => received.push(payload.message),
    });

    webview.send.ready();
    assert.deepEqual(transport.sentMessages, [{ type: 'ready' }]);

    transport.receive({ type: 'error', payload: { message: 'failed' } });
    transport.receive({ type: 'error', payload: { message: 42 } });
    assert.deepEqual(received, ['failed']);

    unsubscribe();
    transport.receive({ type: 'error', payload: { message: 'ignored' } });
    assert.deepEqual(received, ['failed']);
  });

  test('rejects invalid outgoing payloads before they reach the transport', () => {
    const transport = createTestTransport();
    const webview = createProtocolClient(previewProtocol, transport, 'webviewToHost');

    assert.throws(() => webview.send.renderPage({ page: 0 }), TypeError);
    assert.deepEqual(transport.sentMessages, []);

    const compileOnly = (): void => {
      // @ts-expect-error renderPage requires a payload.
      webview.send.renderPage();
      // @ts-expect-error ready does not accept a payload.
      webview.send.ready({ unexpected: true });
      // @ts-expect-error host-to-webview messages are not available on this sender.
      webview.send.init({});
    };
    void compileOnly;
  });
});
