import * as vscode from 'vscode';

import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { OperationCancelledError } from '../../shared/error.js';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import { reportConfigureApplyError } from '../shared/report_configure_error.js';

export interface PdfConfigureSessionOptions<TMessage extends { type: string }, TApply extends TMessage> {
  panel: {
    id: string;
    title: string;
    appRoot: vscode.Uri;
    localResourceRoots: readonly vscode.Uri[];
  };
  webview: {
    title: string;
    appName: string;
    extensionUri: vscode.Uri;
    locale?: string;
  };
  message: {
    isWebviewToHostMessage: (value: unknown) => value is TMessage;
    isApplyMessage: (message: TMessage) => message is TApply;
    buildInitMessage: (panel: vscode.WebviewPanel) => unknown;
    runApply: (message: TApply, context: { panel: vscode.WebviewPanel; signal: AbortSignal }) => Promise<void>;
    onPreviewLoadFailed: (message: TMessage, outputChannel?: LineOutputChannel) => void;
  };
  error: {
    operationName: string;
    cancelledMessage: string;
    failedMessage: (reason: string) => string;
  };
  outputChannel?: LineOutputChannel;
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
export function startPdfConfigureSession<TMessage extends { type: string }, TApply extends TMessage>(
  options: PdfConfigureSessionOptions<TMessage, TApply>,
): PdfConfigureSession {
  const panel = vscode.window.createWebviewPanel(options.panel.id, options.panel.title, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: options.panel.localResourceRoots,
  });
  const htmlOptions = {
    webview: panel.webview,
    extensionUri: options.webview.extensionUri,
    title: options.webview.title,
    appName: options.webview.appName,
    ...(options.webview.locale !== undefined && { locale: options.webview.locale }),
  };
  panel.webview.html = getWebviewHtml(htmlOptions);

  const operationController = new AbortController();
  panel.onDidDispose(() => {
    operationController.abort(new OperationCancelledError(`${options.error.operationName} panel was closed.`));
  });

  let isApplying = false;
  panel.webview.onDidReceiveMessage((rawMessage: unknown) => {
    if (!options.message.isWebviewToHostMessage(rawMessage)) {
      return;
    }

    if (rawMessage.type === 'ready') {
      // VS Code Webview.postMessage has no browser targetOrigin parameter.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      void panel.webview.postMessage(options.message.buildInitMessage(panel));
      return;
    }

    if (rawMessage.type === 'cancel') {
      panel.dispose();
      return;
    }

    if (rawMessage.type === 'previewLoadFailed') {
      options.message.onPreviewLoadFailed(rawMessage, options.outputChannel);
      return;
    }

    if (!options.message.isApplyMessage(rawMessage)) {
      return;
    }

    if (isApplying) {
      return;
    }

    isApplying = true;
    void (async (): Promise<void> => {
      try {
        await options.message.runApply(rawMessage, { panel, signal: operationController.signal });
      } catch (error) {
        await reportConfigureApplyError({
          operationName: options.error.operationName,
          error,
          panel,
          cancelledMessage: options.error.cancelledMessage,
          failedMessage: options.error.failedMessage,
          ...(options.outputChannel !== undefined && { outputChannel: options.outputChannel }),
        });
      } finally {
        isApplying = false;
      }
    })();
  });

  return { panel, signal: operationController.signal };
}
