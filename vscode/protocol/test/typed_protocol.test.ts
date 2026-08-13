import assert from 'node:assert/strict';

import { suite, test } from 'mocha';

import { createMockChannel } from '@graphics-workbench/vscode-protocol/typed-protocol';
import { previewProtocol } from '@graphics-workbench/vscode-protocol/preview-protocol';

suite('typed Webview protocol transport', () => {
  test('derives directional senders and validates incoming messages', () => {
    const channel = createMockChannel(previewProtocol);
    const received: string[] = [];
    const hostReceived: unknown[] = [];

    channel.hostToWebview.subscribe((message) => hostReceived.push(message));
    const unsubscribe = channel.webviewToHost.on({
      error: (payload) => received.push(payload.message),
    });

    channel.webviewToHost.send.ready();
    assert.deepEqual(hostReceived, [{ type: 'ready' }]);

    channel.deliverHostToWebview({ type: 'error', payload: { message: 'failed' } });
    channel.deliverHostToWebview({ type: 'error', payload: { message: 42 } });
    assert.deepEqual(received, ['failed']);

    unsubscribe();
    channel.deliverHostToWebview({ type: 'error', payload: { message: 'ignored' } });
    assert.deepEqual(received, ['failed']);
  });

  test('rejects invalid outgoing payloads before they reach the transport', () => {
    const channel = createMockChannel(previewProtocol);
    const received: unknown[] = [];
    const unsubscribe = channel.hostToWebview.subscribe((message) => received.push(message));

    assert.throws(() => channel.webviewToHost.send.renderPage({ page: 0 }), TypeError);
    assert.deepEqual(received, []);

    const compileOnly = (): void => {
      // @ts-expect-error renderPage requires a payload.
      channel.webviewToHost.send.renderPage();
      // @ts-expect-error ready does not accept a payload.
      channel.webviewToHost.send.ready({ unexpected: true });
      // @ts-expect-error host-to-webview messages are not available on this sender.
      channel.webviewToHost.send.init({});
    };
    void compileOnly;
    void unsubscribe;
  });
});
