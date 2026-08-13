/* oxlint-disable typescript/no-restricted-types, typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion -- the generic transport crosses an unknown runtime boundary and uses one validated Proxy implementation for all inferred protocol shapes. */
import * as v from 'valibot';

export interface ProtocolTransport {
  send(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export type WireSchema = v.GenericSchema<unknown, { type: string }>;

export const MessageCatalogSchema = v.record(v.string(), v.string());
export type MessageCatalog = v.InferOutput<typeof MessageCatalogSchema>;

export interface MessageProtocol<HostSchema extends WireSchema, WebviewSchema extends WireSchema> {
  readonly hostToWebview: HostSchema;
  readonly webviewToHost: WebviewSchema;
  readonly parseHostToWebview: (value: unknown) => v.InferOutput<HostSchema> | undefined;
  readonly parseWebviewToHost: (value: unknown) => v.InferOutput<WebviewSchema> | undefined;
}

type MessageType<Message> = Message extends { type: infer Type extends string } ? Type : never;
type MessageWithType<Message, Type extends string> = Extract<Message, { type: Type }>;
type MessageArguments<Message> = Message extends { payload: infer Payload } ? [payload: Payload] : [];

export type ProtocolMessage<
  Protocol extends MessageProtocol<WireSchema, WireSchema>,
  Direction extends 'hostToWebview' | 'webviewToHost',
> = Direction extends 'hostToWebview'
  ? v.InferOutput<Protocol['hostToWebview']>
  : v.InferOutput<Protocol['webviewToHost']>;

export type ProtocolSender<Message extends { type: string }> = {
  [Type in MessageType<Message>]: (...args: MessageArguments<MessageWithType<Message, Type>>) => void;
};

export type ProtocolHandlers<Message extends { type: string }> = Partial<{
  [Type in MessageType<Message>]: (...args: MessageArguments<MessageWithType<Message, Type>>) => void;
}>;

export type CompleteProtocolHandlers<Message extends { type: string }> = {
  [Type in MessageType<Message>]: (...args: MessageArguments<MessageWithType<Message, Type>>) => void;
};

export interface ProtocolClient<Message extends { type: string }> {
  readonly send: ProtocolSender<Message>;
  on(handlers: ProtocolHandlers<Message>): () => void;
  subscribe(listener: (message: Message) => void): () => void;
}

export function defineProtocol<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(options: {
  hostToWebview: HostSchema;
  webviewToHost: WebviewSchema;
}): MessageProtocol<HostSchema, WebviewSchema> {
  return {
    ...options,
    parseHostToWebview: createParser(options.hostToWebview),
    parseWebviewToHost: createParser(options.webviewToHost),
  };
}

export function createProtocolClient<
  const HostSchema extends WireSchema,
  const WebviewSchema extends WireSchema,
  const Direction extends 'hostToWebview' | 'webviewToHost',
>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
  transport: ProtocolTransport,
  direction: Direction,
): ProtocolClient<Direction extends 'hostToWebview' ? v.InferOutput<HostSchema> : v.InferOutput<WebviewSchema>> {
  type Message = Direction extends 'hostToWebview' ? v.InferOutput<HostSchema> : v.InferOutput<WebviewSchema>;
  const schema = direction === 'hostToWebview' ? protocol.hostToWebview : protocol.webviewToHost;
  const parse = direction === 'hostToWebview' ? protocol.parseHostToWebview : protocol.parseWebviewToHost;
  const send = new Proxy(
    {},
    {
      get: (_target, type: string) => (payload?: unknown) => {
        const message = payload === undefined ? { type } : { type, payload };
        const result = v.safeParse(schema, message);
        if (!result.success) {
          throw new TypeError(`Invalid ${direction} message: ${type}`);
        }
        transport.send(result.output);
      },
    },
  ) as ProtocolSender<Message & { type: string }>;

  const on = (handlers: ProtocolHandlers<Message & { type: string }>): (() => void) =>
    subscribe((message) => {
      const handler = handlers[message.type as keyof typeof handlers];
      if (handler === undefined) {
        return;
      }
      Reflect.apply(handler, undefined, 'payload' in message ? [message.payload] : []);
    });

  const subscribe = (listener: (message: Message) => void): (() => void) =>
    transport.subscribe((rawMessage) => {
      const message = parse(rawMessage);
      if (message !== undefined) {
        listener(message as Message);
      }
    });

  return {
    send,
    on,
    subscribe,
  } as ProtocolClient<Direction extends 'hostToWebview' ? v.InferOutput<HostSchema> : v.InferOutput<WebviewSchema>>;
}

/**
 * A loopback channel for browser development and unit tests. Both directions
 * are wired through the same `createProtocolClient` pipeline as production,
 * so every message exchanged by the mock is validated exactly like a real
 * Extension Host <-> Webview boundary.
 */
export interface MockChannel<HostMessage extends { type: string }, WebviewMessage extends { type: string }> {
  /** Extension Host endpoint: sends hostToWebview messages, receives webviewToHost. */
  readonly host: {
    readonly send: ProtocolSender<HostMessage>;
    on(handlers: ProtocolHandlers<WebviewMessage>): () => void;
    subscribe(listener: (message: WebviewMessage) => void): () => void;
  };
  /** Webview endpoint: sends webviewToHost messages, receives hostToWebview. */
  readonly webview: {
    readonly send: ProtocolSender<WebviewMessage>;
    on(handlers: ProtocolHandlers<HostMessage>): () => void;
    subscribe(listener: (message: HostMessage) => void): () => void;
  };
  /** Injects a raw (unparsed) hostToWebview message toward the Webview endpoint. */
  readonly deliverHostToWebview: (message: unknown) => void;
  /** Injects a raw (unparsed) webviewToHost message toward the Extension Host endpoint. */
  readonly deliverWebviewToHost: (message: unknown) => void;
}

export function createMockChannel<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
): MockChannel<v.InferOutput<HostSchema>, v.InferOutput<WebviewSchema>> {
  const [hostTransport, webviewTransport] = loopbackTransports();

  const hostOutgoing = createProtocolClient(protocol, hostTransport, 'hostToWebview');
  const hostIncoming = createProtocolClient(protocol, hostTransport, 'webviewToHost');
  const webviewOutgoing = createProtocolClient(protocol, webviewTransport, 'webviewToHost');
  const webviewIncoming = createProtocolClient(protocol, webviewTransport, 'hostToWebview');

  return {
    host: {
      send: hostOutgoing.send,
      on: (handlers) => hostIncoming.on(handlers),
      subscribe: (listener) => hostIncoming.subscribe(listener),
    },
    webview: {
      send: webviewOutgoing.send,
      on: (handlers) => webviewIncoming.on(handlers),
      subscribe: (listener) => webviewIncoming.subscribe(listener),
    },
    deliverHostToWebview: (message) => hostTransport.send(message),
    deliverWebviewToHost: (message) => webviewTransport.send(message),
  };
}

function loopbackTransports(): [ProtocolTransport, ProtocolTransport] {
  const firstListeners = new Set<(message: unknown) => void>();
  const secondListeners = new Set<(message: unknown) => void>();
  const first: ProtocolTransport = {
    send(message) {
      for (const listener of secondListeners) {
        listener(message);
      }
    },
    subscribe(listener) {
      firstListeners.add(listener);
      return () => firstListeners.delete(listener);
    },
  };
  const second: ProtocolTransport = {
    send(message) {
      for (const listener of firstListeners) {
        listener(message);
      }
    },
    subscribe(listener) {
      secondListeners.add(listener);
      return () => secondListeners.delete(listener);
    },
  };
  return [first, second];
}

function createParser<const Schema extends WireSchema>(schema: Schema) {
  return (value: unknown): v.InferOutput<Schema> | undefined => {
    const result = v.safeParse(schema, value);
    return result.success ? result.output : undefined;
  };
}
