import assert from 'node:assert/strict';

import { createMockChannel } from '@graphics-workbench/vscode-protocol/typed-protocol';
import { previewProtocol } from '@graphics-workbench/vscode-protocol/preview-protocol';

describe('typed Webview protocol transport', () => {
  it('derives directional senders and validates incoming messages', () => {
    const channel = createMockChannel(previewProtocol);
    const received: string[] = [];
    const hostReceived: unknown[] = [];

    channel.host.subscribe((message) => hostReceived.push(message));
    const unsubscribe = channel.webview.on({
      error: (payload) => received.push(payload.message),
    });

    channel.webview.send.ready();
    assert.deepEqual(hostReceived, [{ type: 'ready' }]);

    channel.deliverHostToWebview({ type: 'error', payload: { message: 'failed' } });
    channel.deliverHostToWebview({ type: 'error', payload: { message: 42 } });
    assert.deepEqual(received, ['failed']);

    unsubscribe();
    channel.deliverHostToWebview({ type: 'error', payload: { message: 'ignored' } });
    assert.deepEqual(received, ['failed']);
  });

  it('rejects invalid outgoing payloads before they reach the transport', () => {
    const channel = createMockChannel(previewProtocol);
    const received: unknown[] = [];
    const unsubscribe = channel.host.subscribe((message) => received.push(message));

    assert.throws(() => channel.webview.send.renderPage({ page: 0 }), TypeError);
    assert.deepEqual(received, []);

    const compileOnly = (): void => {
      // @ts-expect-error renderPage requires a payload.
      channel.webview.send.renderPage();
      // @ts-expect-error ready does not accept a payload.
      channel.webview.send.ready({ unexpected: true });
      // @ts-expect-error host-to-webview messages are not available on this sender.
      channel.webview.send.init({});
    };
    void compileOnly;
    void unsubscribe;
  });
});
