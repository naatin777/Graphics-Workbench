import * as vscode from 'vscode';

import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import { OperationCancelledError } from '@graphics-workbench/core/runtime';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import { reportConfigureApplyError } from '../shared/report_configure_error.js';

export interface PdfConfigureSessionOptions<
  WebviewMessage extends { type: string },
  TApply extends WebviewMessage,
  InitPayload,
> {
  panel: vscode.WebviewPanel;
  sendInit: (payload: InitPayload) => void;
  sendError: (message: string) => void;
  subscribeMessages: (listener: (message: WebviewMessage) => void) => () => void;
  message: {
    isApplyMessage: (message: WebviewMessage) => message is TApply;
    buildInitPayload: (panel: vscode.WebviewPanel) => InitPayload;
    runApply: (
      message: TApply,
      context: { panel: vscode.WebviewPanel; signal: AbortSignal; sendError: (message: string) => void },
    ) => Promise<void>;
    onPreviewLoadFailed: (message: WebviewMessage, outputChannel?: LineOutputChannel) => void;
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

/** Creates the shared Webview Configure panel and installs the production HTML. */
export function openConfigurePanel(options: {
  panel: {
    id: string;
    title: string;
    localResourceRoots: readonly vscode.Uri[];
  };
  webview: {
    title: string;
    pageId: string;
    extensionUri: vscode.Uri;
    locale?: string;
  };
}): vscode.WebviewPanel {
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
  return panel;
}

/**
 * Owns the shared Webview Configure session: ready/init, preview failure,
 * apply lock, panel-close cancellation, and apply error routing. The caller
 * supplies the concrete channel sends and subscription, so init/error stays
 * typed by the caller's protocol without casts.
 */
export function startPdfConfigureSession<
  WebviewMessage extends { type: string },
  TApply extends WebviewMessage,
  InitPayload,
>(options: PdfConfigureSessionOptions<WebviewMessage, TApply, InitPayload>): PdfConfigureSession {
  const { panel } = options;

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
  const unsubscribeMessages = options.subscribeMessages((message) => {
    if (message.type === 'ready') {
      options.sendInit(options.message.buildInitPayload(panel));
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
          sendError: options.sendError,
        });
      } catch (error) {
        await reportConfigureApplyError({
          operationName: options.error.operationName,
          error,
          panel,
          cancelledMessage: options.error.cancelledMessage,
          failedMessage: options.error.failedMessage,
          ...(options.outputChannel !== undefined && { outputChannel: options.outputChannel }),
          sendError: options.sendError,
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
