import type { WebviewToExtensionMessage } from './messages';

type VsCodeApi = {
  sendMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type RawVsCodeApi = {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare const acquireVsCodeApi: (() => RawVsCodeApi) | undefined;

function createVsCodeApi(): VsCodeApi {
  if (typeof acquireVsCodeApi === 'function') {
    const api = acquireVsCodeApi();
    return {
      sendMessage: api.postMessage.bind(api),
      getState: api.getState.bind(api),
      setState: api.setState.bind(api),
    };
  }

  // ブラウザで Vite dev / unit test するとき用の fallback。
  return {
    sendMessage(message) {
      void message;
    },
    getState() {
      return undefined;
    },
    setState() {
      // noop
    },
  };
}

export const vscode = createVsCodeApi();
