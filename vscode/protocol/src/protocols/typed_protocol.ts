/* oxlint-disable typescript/no-restricted-types, typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion -- the generic transport crosses an unknown runtime boundary and uses one validated Proxy implementation for all inferred protocol shapes. */
import * as v from 'valibot';

export interface ProtocolTransport {
  send(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export type WireSchema = v.GenericSchema<unknown, { type: string }>;

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
  onAll(handlers: CompleteProtocolHandlers<Message>): () => void;
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
    onAll: (handlers) => on(handlers),
    subscribe,
  } as ProtocolClient<Direction extends 'hostToWebview' ? v.InferOutput<HostSchema> : v.InferOutput<WebviewSchema>>;
}

/**
 * A loopback channel for browser development and unit tests. Both directions
 * are wired through the protocol parsers, so every message exchanged by the
 * mock is validated exactly like a real Extension Host <-> Webview boundary.
 */
export interface MockChannel<HostMessage extends { type: string }, WebviewMessage extends { type: string }> {
  /** Extension Host side: sends hostToWebview, receives parsed webviewToHost. */
  readonly hostToWebview: {
    readonly send: ProtocolSender<HostMessage>;
    on(handlers: ProtocolHandlers<WebviewMessage>): () => void;
    subscribe(listener: (message: WebviewMessage) => void): () => void;
  };
  /** Webview side: sends webviewToHost, receives parsed hostToWebview. */
  readonly webviewToHost: {
    readonly send: ProtocolSender<WebviewMessage>;
    on(handlers: ProtocolHandlers<HostMessage>): () => void;
    subscribe(listener: (message: HostMessage) => void): () => void;
  };
  /** Injects a raw (unparsed) hostToWebview message toward the Webview side. */
  readonly deliverHostToWebview: (message: unknown) => void;
  /** Injects a raw (unparsed) webviewToHost message toward the Extension Host side. */
  readonly deliverWebviewToHost: (message: unknown) => void;
}

export function createMockChannel<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
): MockChannel<v.InferOutput<HostSchema>, v.InferOutput<WebviewSchema>> {
  const hostToWebviewListeners = new Set<(message: unknown) => void>();
  const webviewToHostListeners = new Set<(message: unknown) => void>();

  const deliverHostToWebview = (message: unknown): void => {
    for (const listener of hostToWebviewListeners) {
      listener(message);
    }
  };
  const deliverWebviewToHost = (message: unknown): void => {
    for (const listener of webviewToHostListeners) {
      listener(message);
    }
  };

  const hostSideTransport: ProtocolTransport = {
    send: deliverHostToWebview,
    subscribe(listener) {
      webviewToHostListeners.add(listener);
      return () => webviewToHostListeners.delete(listener);
    },
  };
  const webviewSideTransport: ProtocolTransport = {
    send: deliverWebviewToHost,
    subscribe(listener) {
      hostToWebviewListeners.add(listener);
      return () => hostToWebviewListeners.delete(listener);
    },
  };

  return {
    hostToWebview: createSideClient<v.InferOutput<HostSchema>, v.InferOutput<WebviewSchema>>(
      protocol.hostToWebview,
      protocol.parseWebviewToHost,
      hostSideTransport,
    ),
    webviewToHost: createSideClient<v.InferOutput<WebviewSchema>, v.InferOutput<HostSchema>>(
      protocol.webviewToHost,
      protocol.parseHostToWebview,
      webviewSideTransport,
    ),
    deliverHostToWebview,
    deliverWebviewToHost,
  };
}

function createSideClient<SendMessage extends { type: string }, ReceiveMessage extends { type: string }>(
  schema: WireSchema,
  parse: (value: unknown) => ReceiveMessage | undefined,
  transport: ProtocolTransport,
): {
  readonly send: ProtocolSender<SendMessage>;
  on(handlers: ProtocolHandlers<ReceiveMessage>): () => void;
  subscribe(listener: (message: ReceiveMessage) => void): () => void;
} {
  const send = new Proxy(
    {},
    {
      get: (_target, type: string) => (payload?: unknown) => {
        const message = payload === undefined ? { type } : { type, payload };
        const result = v.safeParse(schema, message);
        if (!result.success) {
          throw new TypeError(`Invalid message: ${type}`);
        }
        transport.send(result.output);
      },
    },
  ) as ProtocolSender<SendMessage>;

  const on = (handlers: ProtocolHandlers<ReceiveMessage>): (() => void) =>
    subscribe((message) => {
      const handler = handlers[message.type as keyof typeof handlers];
      if (handler === undefined) {
        return;
      }
      Reflect.apply(handler, undefined, 'payload' in message ? [message.payload] : []);
    });

  const subscribe = (listener: (message: ReceiveMessage) => void): (() => void) =>
    transport.subscribe((rawMessage) => {
      const message = parse(rawMessage);
      if (message !== undefined) {
        listener(message);
      }
    });

  return {
    send,
    on,
    subscribe,
  };
}

function createParser<const Schema extends WireSchema>(schema: Schema) {
  return (value: unknown): v.InferOutput<Schema> | undefined => {
    const result = v.safeParse(schema, value);
    return result.success ? result.output : undefined;
  };
}
