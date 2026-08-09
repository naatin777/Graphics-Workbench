export interface VsCodeApi<Message> {
  sendMessage(message: Message): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface RawVsCodeApi<Message> {
  postMessage(message: Message): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare const acquireVsCodeApi: (<Message>() => RawVsCodeApi<Message>) | undefined;

/** Creates the VS Code bridge, with a no-op implementation for browser development and unit tests. */
export function createVsCodeApi<Message>(): VsCodeApi<Message> {
  if (typeof acquireVsCodeApi === 'function') {
    const api = acquireVsCodeApi<Message>();
    return {
      sendMessage: api.postMessage.bind(api),
      getState: api.getState.bind(api),
      setState: api.setState.bind(api),
    };
  }

  return {
    sendMessage(message) {
      void message;
    },
    getState() {
      // No persisted state is available outside VS Code.
    },
    setState() {
      // No persisted state is available outside VS Code.
    },
  };
}
