import * as vscode from 'vscode';
import type * as v from 'valibot';

import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import { OperationCancelledError } from '@graphics-workbench/core/runtime';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import {
  createExtensionChannel,
  createWebviewTransport,
  sendExtensionError,
  sendExtensionInit,
  type ExtensionChannel,
} from '../../presentation/webview/typed_channel.js';
import type { MessageProtocol, WireSchema } from '../../../../protocol/protocols/typed_protocol.js';
import { reportConfigureApplyError } from '../shared/report_configure_error.js';

type WireMessage<Schema extends WireSchema> = v.InferOutput<Schema> & { type: string };

export interface PdfConfigureSessionOptions<
  HostSchema extends WireSchema,
  WebviewSchema extends WireSchema,
  TApply extends WireMessage<WebviewSchema>,
> {
  protocol: MessageProtocol<HostSchema, WebviewSchema>;
  panel: {
    id: string;
    title: string;
    appRoot: vscode.Uri;
    localResourceRoots: readonly vscode.Uri[];
  };
  webview: {
    title: string;
    pageId: string;
    extensionUri: vscode.Uri;
    locale?: string;
  };
  message: {
    isApplyMessage: (message: WireMessage<WebviewSchema>) => message is TApply;
    buildInitPayload: (
      panel: vscode.WebviewPanel,
    ) => Extract<WireMessage<HostSchema>, { type: 'init' }> extends { payload: infer Payload } ? Payload : never;
    runApply: (
      message: TApply,
      context: { panel: vscode.WebviewPanel; signal: AbortSignal; sendError: (message: string) => void },
    ) => Promise<void>;
    onPreviewLoadFailed: (message: WireMessage<WebviewSchema>, outputChannel?: LineOutputChannel) => void;
  };
  error: {
    operationName: string;
    cancelledMessage: string;
    failedMessage: (reason: string) => string;
  };
  outputChannel?: LineOutputChannel;
  /** When provided, aborts an in-flight apply when the extension host shuts down. */
  extensionShutdown?: { context: vscode.ExtensionContext };
}

export interface PdfConfigureSession {
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
}

/**
 * Owns the shared Webview Configure session: panel lifecycle, ready/init, preview
 * failure, apply lock, panel-close cancellation, and apply error routing.
 * Domain-specific init payloads and apply operations stay with each command.
 */
export function startPdfConfigureSession<
  HostSchema extends WireSchema,
  WebviewSchema extends WireSchema,
  TApply extends WireMessage<WebviewSchema>,
>(options: PdfConfigureSessionOptions<HostSchema, WebviewSchema, TApply>): PdfConfigureSession {
  const panel = vscode.window.createWebviewPanel(options.panel.id, options.panel.title, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: options.panel.localResourceRoots,
  });
  const htmlOptions = {
    webview: panel.webview,
    extensionUri: options.webview.extensionUri,
    title: options.webview.title,
    pageId: options.webview.pageId,
    ...(options.webview.locale !== undefined && { locale: options.webview.locale }),
  };
  panel.webview.html = getWebviewHtml(htmlOptions);
  const transport = createWebviewTransport(panel.webview);
  const channel: ExtensionChannel<HostSchema, WebviewSchema> = createExtensionChannel(options.protocol, transport);

  const operationController = new AbortController();
  panel.onDidDispose(() => {
    operationController.abort(new OperationCancelledError(`${options.error.operationName} panel was closed.`));
  });

  if (options.extensionShutdown !== undefined) {
    options.extensionShutdown.context.subscriptions.push(
      new vscode.Disposable(() => {
        operationController.abort(
          new OperationCancelledError(`${options.error.operationName} was cancelled during extension shutdown.`),
        );
      }),
    );
  }

  let isApplying = false;
  const unsubscribeMessages = channel.subscribe((message) => {
    if (message.type === 'ready') {
      sendExtensionInit(channel, options.message.buildInitPayload(panel));
      return;
    }

    if (message.type === 'cancel') {
      panel.dispose();
      return;
    }

    if (message.type === 'previewLoadFailed') {
      options.message.onPreviewLoadFailed(message, options.outputChannel);
      return;
    }

    if (!options.message.isApplyMessage(message)) {
      return;
    }

    if (isApplying) {
      return;
    }

    isApplying = true;
    void (async (): Promise<void> => {
      try {
        await options.message.runApply(message, {
          panel,
          signal: operationController.signal,
          sendError: (errorMessage) => {
            sendExtensionError(channel, errorMessage);
          },
        });
      } catch (error) {
        await reportConfigureApplyError({
          operationName: options.error.operationName,
          error,
          panel,
          cancelledMessage: options.error.cancelledMessage,
          failedMessage: options.error.failedMessage,
          ...(options.outputChannel !== undefined && { outputChannel: options.outputChannel }),
          sendError: (errorMessage) => {
            sendExtensionError(channel, errorMessage);
          },
        });
      } finally {
        isApplying = false;
      }
    })();
  });
  panel.onDidDispose(() => {
    unsubscribeMessages();
  });

  return { panel, signal: operationController.signal };
}
