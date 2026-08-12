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

export class TestTransport implements ProtocolTransport {
  readonly sentMessages: unknown[] = [];
  private readonly listeners = new Set<(message: unknown) => void>();

  send(message: unknown): void {
    this.sentMessages.push(message);
  }

  subscribe(listener: (message: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(message: unknown): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

export const createMockTransport = (): TestTransport => new TestTransport();
export const createTestTransport = (): TestTransport => new TestTransport();

function createParser<const Schema extends WireSchema>(schema: Schema) {
  return (value: unknown): v.InferOutput<Schema> | undefined => {
    const result = v.safeParse(schema, value);
    return result.success ? result.output : undefined;
  };
}
