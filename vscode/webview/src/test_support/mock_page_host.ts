import {
  createMockChannel,
  type MessageProtocol,
  type ProtocolHandlers,
  type ProtocolSender,
  type WireSchema,
} from '@graphics-workbench/vscode-protocol/typed-protocol';
import type * as v from 'valibot';

interface TestPageHost<Outgoing extends { type: string }, Incoming extends { type: string }> {
  readonly send: ProtocolSender<Outgoing>;
  on(handlers: ProtocolHandlers<Incoming>): () => void;
  subscribe(listener: (message: Incoming) => void): () => void;
}

export function createTestPageHost<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
  sendMessage: (message: v.InferOutput<WebviewSchema>) => void,
): TestPageHost<v.InferOutput<WebviewSchema> & { type: string }, v.InferOutput<HostSchema> & { type: string }> {
  const channel = createMockChannel(protocol);
  channel.hostToWebview.subscribe((message) => sendMessage(message));
  const onMessage = (event: Event): void => {
    channel.deliverHostToWebview((event as MessageEvent).data);
  };
  globalThis.addEventListener('message', onMessage);
  return {
    send: channel.webviewToHost.send,
    on: (handlers) => channel.webviewToHost.on(handlers),
    subscribe: (listener) => channel.webviewToHost.subscribe(listener),
  };
}
