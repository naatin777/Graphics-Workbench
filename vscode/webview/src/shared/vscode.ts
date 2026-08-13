import {
  createProtocolClient,
  type MessageProtocol,
  type ProtocolHandlers,
  type ProtocolSender,
  type WireSchema,
} from '@graphics-workbench-typed-protocol';
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

export class MockHost<Outgoing = unknown, Incoming = unknown> implements WebviewHost<Outgoing, Incoming> {
  readonly sentMessages: Outgoing[] = [];
  private readonly listeners = new Set<(message: Incoming) => void>();
  private state: unknown;

  constructor(private readonly onSend?: (message: Outgoing, host: MockHost<Outgoing, Incoming>) => void) {}

  send(message: Outgoing): void {
    this.sentMessages.push(message);
    this.onSend?.(message, this);
  }

  subscribe(listener: (message: Incoming) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(message: Incoming): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  getState<T>(): T | undefined {
    return this.state as T | undefined;
  }

  setState<T>(state: T): void {
    this.state = state;
  }
}

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

let activeHost: WebviewHost | undefined;

function requireActiveWebviewHost(): WebviewHost {
  if (activeHost === undefined) {
    throw new Error('Webview host has not been initialized.');
  }
  return activeHost;
}

export function setActiveWebviewHost(host: WebviewHost): void {
  activeHost = host;
}

export function createPageProtocolClient<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
): PageProtocolClient<v.InferOutput<WebviewSchema> & { type: string }, v.InferOutput<HostSchema> & { type: string }> {
  const sender = new Proxy(
    {},
    {
      get:
        (_target, type: string) =>
        (...args: unknown[]) => {
          const client = createProtocolClient(protocol, requireActiveWebviewHost(), 'webviewToHost');
          Reflect.apply(client.send[type as keyof typeof client.send], client.send, args);
        },
    },
  ) as PageProtocolClient<
    v.InferOutput<WebviewSchema> & { type: string },
    v.InferOutput<HostSchema> & { type: string }
  >['send'];
  return {
    send: sender,
    on: (handlers) => createProtocolClient(protocol, requireActiveWebviewHost(), 'hostToWebview').on(handlers),
    subscribe: (listener) =>
      createProtocolClient(protocol, requireActiveWebviewHost(), 'hostToWebview').subscribe(listener),
  } as PageProtocolClient<
    v.InferOutput<WebviewSchema> & { type: string },
    v.InferOutput<HostSchema> & { type: string }
  >;
}
