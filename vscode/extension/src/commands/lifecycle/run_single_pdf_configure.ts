import path from 'node:path';

import * as vscode from 'vscode';

import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import type { CommittedConversionOutput, ConversionExecutionContext } from '@graphics-workbench/core/runtime';
import { assertExistingPathInWorkspace } from '@graphics-workbench/core/security';
import type { MessageProtocol, WireSchema } from '@graphics-workbench/vscode-protocol/typed-protocol';
import type { WebviewPageId } from '@graphics-workbench/vscode-protocol/webview-page';

import type { Configuration } from '../../generated/extension_manifest.js';
import { getPdfJsAssetsRoot, getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';
import { createExtensionChannel, createWebviewTransport } from '../../presentation/webview/typed_channel.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveSingleConfiguredPdfUri } from '../shared/command_input.js';
import { openConfigurePanel, startPdfConfigureSession } from './pdf_configure_session.js';
import { withCancellationSignal } from './progress_cancellation.js';
import { runConfiguredPdfConversion } from './run_configured_conversion.js';
import type { ConversionCommandMessages } from './run_output_conversion.js';

export type SinglePdfConfigureConversion = (
  runtime: ConversionExecutionContext,
) => Promise<CommittedConversionOutput[]>;

export interface SinglePdfConfigurePrepareParams {
  inputUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  signal: AbortSignal;
  report: (message: string) => void;
}

export interface SinglePdfConfigureBuildInitParams<Prepared> {
  panel: vscode.WebviewPanel;
  inputUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  prepared: Prepared;
  pdfJsAssetsRoot: vscode.Uri;
  configuration: Configuration;
}

export interface SinglePdfConfigureApplyParams<Prepared> {
  panel: vscode.WebviewPanel;
  signal: AbortSignal;
  sendError: (message: string) => void;
  inputUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  prepared: Prepared;
  runConversion: (run: SinglePdfConfigureConversion) => Promise<void>;
}

export interface RunSinglePdfConfigureOptions<
  Prepared,
  InitPayload,
  WebviewMessage extends { type: string },
  TApply extends WebviewMessage,
> {
  context: vscode.ExtensionContext;
  sourceUris: vscode.Uri[];
  dependencies: CommandDependencies;
  commandId: string;
  pageId: WebviewPageId;
  panelId: string;
  panelTitle: string;
  protocol: MessageProtocol<WireSchema, WireSchema>;
  operationName: string;
  messages: ConversionCommandMessages;
  prepare: (params: SinglePdfConfigurePrepareParams) => Promise<Prepared>;
  buildInitPayload: (params: SinglePdfConfigureBuildInitParams<Prepared>) => InitPayload;
  isApplyMessage: (message: WebviewMessage) => message is TApply;
  runApply: (message: TApply, params: SinglePdfConfigureApplyParams<Prepared>) => Promise<void>;
  onPreviewLoadFailed: (message: WebviewMessage, outputChannel?: LineOutputChannel) => void;
}

export async function runSinglePdfConfigureCommand<
  Prepared,
  InitPayload,
  WebviewMessage extends { type: string },
  TApply extends WebviewMessage,
>(options: RunSinglePdfConfigureOptions<Prepared, InitPayload, WebviewMessage, TApply>): Promise<void> {
  const {
    context,
    sourceUris,
    dependencies,
    commandId,
    pageId,
    panelId,
    panelTitle,
    protocol,
    operationName,
    messages,
    prepare,
    buildInitPayload,
    isApplyMessage,
    runApply,
    onPreviewLoadFailed,
  } = options;
  const { outputChannel } = dependencies;

  const inputUri = resolveSingleConfiguredPdfUri(sourceUris, commandId);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(inputUri);

  if (!workspaceFolder) {
    throw new Error(`${commandId} input must be inside the workspace.`);
  }

  await assertExistingPathInWorkspace(inputUri.fsPath, workspaceFolder.uri.fsPath);

  const prepared = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: messages.progressTitle,
      cancellable: true,
    },
    async (progress, token) =>
      withCancellationSignal(token, async (signal) => {
        signal.throwIfAborted();
        return prepare({
          inputUri,
          workspaceFolder,
          signal,
          report: (message) => {
            progress.report({ message });
          },
        });
      }),
  );

  const configuration = dependencies.getConfiguration();
  const appRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview');
  const pdfJsAssetsRoot = getPdfJsAssetsRoot(context.extensionUri);
  const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(context.extensionUri);
  const configurePanel = openConfigurePanel({
    panel: {
      id: panelId,
      title: panelTitle,
      localResourceRoots: [
        appRoot,
        pdfJsAssetsRoot,
        webviewSharedAssetsRoot,
        vscode.Uri.file(path.dirname(inputUri.fsPath)),
      ],
    },
    webview: {
      title: panelTitle,
      pageId,
      extensionUri: context.extensionUri,
      locale: vscode.env.language,
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-restricted-types -- protocolの具体型は呼び出し側で確定しているが、helperの汎用シグネチャではWireSchemaへ広がるため、セッション配線に必要な型へ境界キャストする。
  const channel = createExtensionChannel(protocol, createWebviewTransport(configurePanel.webview)) as unknown as {
    sendInit: (payload: InitPayload) => void;
    sendError: (payload: { message: string }) => void;
    subscribe: (listener: (message: WebviewMessage) => void) => () => void;
  };

  startPdfConfigureSession({
    panel: configurePanel,
    sendInit: channel.sendInit,
    sendError: (message) => {
      channel.sendError({ message });
    },
    subscribeMessages: channel.subscribe,
    message: {
      isApplyMessage,
      buildInitPayload: (panel) =>
        buildInitPayload({
          panel,
          inputUri,
          workspaceFolder,
          prepared,
          pdfJsAssetsRoot,
          configuration,
        }),
      runApply: async (message, { panel, signal, sendError: sessionSendError }) => {
        await runApply(message, {
          panel,
          signal,
          sendError: sessionSendError,
          inputUri,
          workspaceFolder,
          prepared,
          runConversion: async (run) =>
            runConfiguredPdfConversion({
              operationName,
              messages,
              outputChannel,
              panel,
              signal,
              sendError: sessionSendError,
              run,
            }),
        });
      },
      onPreviewLoadFailed,
    },
    error: {
      operationName,
      cancelledMessage: messages.cancelledMessage,
      failedMessage: messages.failedMessage,
    },
    outputChannel,
    extensionShutdown: { context },
  });
}
