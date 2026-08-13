import {
  createProtocolClient,
  type MessageProtocol,
  type ProtocolHandlers,
  type ProtocolSender,
  type WireSchema,
} from '@graphics-workbench/vscode-protocol/typed-protocol';
import type * as v from 'valibot';

export interface WebviewHost<Outgoing = unknown, Incoming = unknown> {
  send(message: Outgoing): void;
  subscribe(listener: (message: Incoming) => void): () => void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

export interface PageProtocolClient<Outgoing extends { type: string }, Incoming extends { type: string }> {
  readonly send: ProtocolSender<Outgoing>;
  on(handlers: ProtocolHandlers<Incoming>): () => void;
  subscribe(listener: (message: Incoming) => void): () => void;
}

interface RawVsCodeApi<Message> {
  postMessage(message: Message): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare const acquireVsCodeApi: (<Message>() => RawVsCodeApi<Message>) | undefined;

export function createVsCodeHost(): WebviewHost {
  if (typeof acquireVsCodeApi !== 'function') {
    throw new Error('VS Code webview API is unavailable outside the Extension Host.');
  }

  const api = acquireVsCodeApi<unknown>();
  const listeners = new Set<(message: unknown) => void>();
  const onMessage = (event: MessageEvent<unknown>): void => {
    for (const listener of listeners) {
      listener(event.data);
    }
  };
  globalThis.addEventListener('message', onMessage);

  return {
    send: (message) => {
      // VS Code's acquireVsCodeApi does not expose a target origin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      api.postMessage(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: <T>() => api.getState() as T | undefined,
    setState: <T>(state: T) => api.setState(state),
  };
}

export function createPageProtocolClient<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
  host: WebviewHost,
): PageProtocolClient<v.InferOutput<WebviewSchema> & { type: string }, v.InferOutput<HostSchema> & { type: string }> {
  const outgoing = createProtocolClient(protocol, host, 'webviewToHost');
  const incoming = createProtocolClient(protocol, host, 'hostToWebview');
  return {
    send: outgoing.send,
    on: (handlers) => incoming.on(handlers),
    subscribe: (listener) => incoming.subscribe(listener),
  };
}
