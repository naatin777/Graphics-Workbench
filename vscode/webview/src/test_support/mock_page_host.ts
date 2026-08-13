import {
  createMockChannel,
  type MessageProtocol,
  type WireSchema,
} from '@graphics-workbench/vscode-protocol/typed-protocol';
import type * as v from 'valibot';

import type { WebviewHost } from '@webview-shared/vscode';

export function createTestPageHost<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
  sendMessage: (message: v.InferOutput<WebviewSchema>) => void,
): WebviewHost {
  const channel = createMockChannel(protocol);
  channel.host.subscribe((message) => sendMessage(message));
  const onMessage = (event: Event): void => {
    channel.deliverHostToWebview((event as MessageEvent).data);
  };
  globalThis.addEventListener('message', onMessage);
  let state: unknown;
  return {
    send: (message) => channel.deliverWebviewToHost(message),
    subscribe: (listener) => channel.webview.subscribe(listener),
    getState: <T>() => state as T | undefined,
    setState: <T>(next: T) => {
      state = next;
    },
  };
}
