/* oxlint-disable typescript/no-restricted-types -- the Configure constraint types bound each protocol's concrete message output at the validated channel boundary. */
import * as vscode from 'vscode';
import type * as v from 'valibot';

import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import {
  OperationCancelledError,
  toErrorMessage,
  type ConversionExecutionContext,
} from '@graphics-workbench/core/runtime';
import type { ConversionResult } from '@graphics-workbench/core/conversion';
import type { WebviewPageId } from '@graphics-workbench/vscode-protocol/webview-page';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import type { ExtensionChannel } from '../../presentation/webview/typed_channel.js';
import { userMessage } from '../shared/user_messages.js';
import { resolveOutputConflicts } from './safe_mode.js';
import { runConversionLifecycle, type ConversionCommandMessages } from './run_output_conversion.js';

type ConfigureHostMessage = { type: 'init'; payload: unknown } | { type: 'error'; payload: { message: string } };
type ConfigureWebviewMessage =
  | { type: 'ready' }
  | { type: 'cancel' }
  | { type: 'previewLoadFailed'; payload: unknown }
  | { type: 'apply'; payload: unknown };

export type ConfigureHostSchema = v.GenericSchema<unknown, ConfigureHostMessage>;
export type ConfigureWebviewSchema = v.GenericSchema<unknown, ConfigureWebviewMessage>;

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
    pageId: WebviewPageId;
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
 * apply lock, panel-close cancellation, and the output-conversion lifecycle
 * behind the panel's apply message.
 */
export function startPdfConfigureSession<
  const HostSchema extends ConfigureHostSchema,
  const WebviewSchema extends ConfigureWebviewSchema,
>(options: {
  panel: vscode.WebviewPanel;
  channel: ExtensionChannel<HostSchema, WebviewSchema>;
  operationName: string;
  messages: ConversionCommandMessages;
  outputChannel: LineOutputChannel;
  buildInitPayload: (panel: vscode.WebviewPanel) => Extract<v.InferOutput<HostSchema>, { type: 'init' }>['payload'];
  apply: (
    payload: Extract<v.InferOutput<WebviewSchema>, { type: 'apply' }>['payload'],
    context: { runtime: ConversionExecutionContext },
  ) => Promise<ConversionResult>;
  onPreviewLoadFailed: (message: v.InferOutput<WebviewSchema>, outputChannel?: LineOutputChannel) => void;
  /** When provided, aborts an in-flight apply when the extension host shuts down. */
  extensionShutdown?: { context: vscode.ExtensionContext };
}): PdfConfigureSession {
  const { panel, outputChannel } = options;
  const channel: ExtensionChannel<ConfigureHostSchema, ConfigureWebviewSchema> = options.channel;

  const operationController = new AbortController();
  panel.onDidDispose(() => {
    operationController.abort(new OperationCancelledError(`${options.operationName} panel was closed.`));
  });

  if (options.extensionShutdown !== undefined) {
    options.extensionShutdown.context.subscriptions.push(
      new vscode.Disposable(() => {
        operationController.abort(
          new OperationCancelledError(`${options.operationName} was cancelled during extension shutdown.`),
        );
      }),
    );
  }

  let isApplying = false;
  const unsubscribeMessages = channel.subscribe((message) => {
    switch (message.type) {
      case 'ready': {
        channel.send.init(options.buildInitPayload(panel));
        return;
      }
      case 'cancel': {
        panel.dispose();
        return;
      }
      case 'previewLoadFailed': {
        options.onPreviewLoadFailed(message, outputChannel);
        return;
      }
      case 'apply': {
        if (isApplying) {
          return;
        }

        isApplying = true;
        void (async (): Promise<void> => {
          try {
            await runConversionLifecycle({
              operationName: options.operationName,
              messages: options.messages,
              outputChannel,
              resolveConflicts: resolveOutputConflicts,
              signal: operationController.signal,
              onSuccess: async ({ undoId, successMessage }) => {
                panel.dispose();
                const undoAction = userMessage('message.action.undo');
                const selectedAction = await vscode.window.showInformationMessage(successMessage, undoAction);
                if (selectedAction === undoAction) {
                  await vscode.commands.executeCommand('graphics-workbench.undoLastConversion', undoId);
                }
              },
              onUndoUnavailable: async ({ successMessage, reason }) => {
                panel.dispose();
                await vscode.window.showWarningMessage(userMessage('message.undoUnavailable', successMessage, reason));
              },
              onError: async (error) => {
                const errorMessage = toErrorMessage(error);
                try {
                  channel.send.error({ message: errorMessage });
                } catch {
                  // The panel may already be disposed; the error notification still informs the user.
                }
              },
              run: async (runtime) => options.apply(message.payload, { runtime }),
            });
          } finally {
            isApplying = false;
          }
        })();
        return;
      }
    }
  });
  panel.onDidDispose(() => {
    unsubscribeMessages();
  });

  return { panel, signal: operationController.signal };
}
