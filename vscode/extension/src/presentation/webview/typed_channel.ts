import type * as vscode from 'vscode';

import {
  createProtocolClient,
  type MessageProtocol,
  type ProtocolHandlers,
  type ProtocolSender,
  type ProtocolTransport,
  type WireSchema,
} from '../../../../protocol/protocols/typed_protocol.js';
import type * as v from 'valibot';

export interface ExtensionChannel<HostSchema extends WireSchema, WebviewSchema extends WireSchema> {
  readonly send: ProtocolSender<v.InferOutput<HostSchema>>;
  on(handlers: ProtocolHandlers<v.InferOutput<WebviewSchema>>): () => void;
  subscribe(listener: (message: v.InferOutput<WebviewSchema>) => void): () => void;
}

export function sendExtensionError<HostSchema extends WireSchema, WebviewSchema extends WireSchema>(
  channel: ExtensionChannel<HostSchema, WebviewSchema>,
  message: string,
): void {
  const sender = channel.send as ProtocolSender<{ type: 'error'; payload: { message: string } }>;
  sender.error({ message });
}

export function sendExtensionInit<HostSchema extends WireSchema, WebviewSchema extends WireSchema>(
  channel: ExtensionChannel<HostSchema, WebviewSchema>,
  payload: Extract<v.InferOutput<HostSchema>, { type: 'init' }> extends { payload: infer Payload } ? Payload : never,
): void {
  const sender = channel.send as ProtocolSender<{ type: 'init'; payload: typeof payload }>;
  sender.init(payload);
}

export function createWebviewTransport(webview: vscode.Webview): ProtocolTransport {
  return {
    send(message) {
      // VS Code Webview.postMessage has no browser targetOrigin parameter.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      void webview.postMessage(message);
    },
    subscribe(listener) {
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
