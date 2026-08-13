import {
  createProtocolClient,
  createTestTransport,
  type MessageProtocol,
  type ProtocolHandlers,
  type ProtocolSender,
  type ProtocolTransport,
  type WireSchema,
} from '@graphics-workbench-typed-protocol';
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
  const transport = createTestTransport();
  const sendToTest = transport.send.bind(transport);
  let subscriptions = 0;
  const onMessage = (event: Event): void => {
    transport.receive((event as MessageEvent).data);
  };
  const testTransport: ProtocolTransport = {
    send(message) {
      sendToTest(message);
      sendMessage(message as v.InferOutput<WebviewSchema>);
    },
    subscribe(listener) {
      if (subscriptions === 0) {
        globalThis.addEventListener('message', onMessage);
      }
      subscriptions += 1;
      const unsubscribe = transport.subscribe(listener);
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        unsubscribe();
        subscriptions -= 1;
        if (subscriptions === 0) {
          globalThis.removeEventListener('message', onMessage);
        }
      };
    },
  };
  const sender = createProtocolClient(protocol, testTransport, 'webviewToHost');
  const receiver = createProtocolClient(protocol, testTransport, 'hostToWebview');

  return {
    send: sender.send,
    on: (handlers) => receiver.on(handlers),
    subscribe: (listener) => receiver.subscribe(listener),
  };
}
