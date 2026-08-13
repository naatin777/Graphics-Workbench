import type * as vscode from 'vscode';

import {
  createProtocolClient,
  type MessageProtocol,
  type ProtocolHandlers,
  type ProtocolSender,
  type ProtocolTransport,
  type WireSchema,
} from '@graphics-workbench/vscode-protocol/typed-protocol';
import type * as v from 'valibot';

export interface ExtensionChannel<HostSchema extends WireSchema, WebviewSchema extends WireSchema> {
  readonly send: ProtocolSender<v.InferOutput<HostSchema>>;
  on(handlers: ProtocolHandlers<v.InferOutput<WebviewSchema>>): () => void;
  subscribe(listener: (message: v.InferOutput<WebviewSchema>) => void): () => void;
}

export function createWebviewTransport(webview: vscode.Webview): ProtocolTransport {
  return {
    send(message) {
      // VS Code Webview.postMessage has no browser targetOrigin parameter.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      void webview.postMessage(message);
    },
    subscribe(listener) {
      // oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
      const disposable = webview.onDidReceiveMessage((message: unknown) => {
        listener(message);
      });
      return () => {
        disposable.dispose();
      };
    },
  };
}

export function createExtensionChannel<const HostSchema extends WireSchema, const WebviewSchema extends WireSchema>(
  protocol: MessageProtocol<HostSchema, WebviewSchema>,
  transport: ProtocolTransport,
): ExtensionChannel<HostSchema, WebviewSchema> {
  const hostClient = createProtocolClient(protocol, transport, 'hostToWebview');
  const webviewClient = createProtocolClient(protocol, transport, 'webviewToHost');
  return {
    send: hostClient.send,
    on(handlers) {
      return webviewClient.on(handlers);
    },
    subscribe(listener) {
      return webviewClient.subscribe(listener);
    },
  };
}
