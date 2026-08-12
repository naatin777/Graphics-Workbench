export function createTestPageHost(sendMessage: (message: unknown) => void): {
  send: Record<string, (payload?: unknown) => void>;
  on: (handlers: Record<string, (payload?: unknown) => void>) => () => void;
  subscribe: (listener: (message: unknown) => void) => () => void;
} {
  const send = new Proxy(
    {},
    {
      get: (_target, type: string) => (payload?: unknown) => {
        sendMessage(payload === undefined ? { type } : { type, payload });
      },
    },
  );
  return {
    send,
    on(handlers) {
      return this.subscribe((message) => {
        if (typeof message !== 'object' || message === null || !('type' in message)) {
          return;
        }
        const type = message.type;
        if (typeof type !== 'string') {
          return;
        }
        const handler = handlers[type];
        if (handler === undefined) {
          return;
        }
        handler('payload' in message ? message.payload : undefined);
      });
    },
    subscribe(listener: (message: unknown) => void): () => void {
      const onMessage = (event: Event): void => {
        listener((event as MessageEvent).data);
      };
      globalThis.addEventListener('message', onMessage);
      return () => {
        globalThis.removeEventListener('message', onMessage);
      };
    },
  };
}
