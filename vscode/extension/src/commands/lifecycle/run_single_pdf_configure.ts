import path from 'node:path';

import * as vscode from 'vscode';
import type * as v from 'valibot';

import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import type { CommittedConversionOutput, ConversionExecutionContext } from '@graphics-workbench/core/runtime';
import { assertExistingPathInWorkspace } from '@graphics-workbench/core/security';
import type { MessageProtocol } from '@graphics-workbench/vscode-protocol/typed-protocol';
import type { WebviewPageId } from '@graphics-workbench/vscode-protocol/webview-page';

import type { Configuration } from '../../generated/extension_manifest.js';
import { getPdfJsAssetsRoot, getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';
import { createExtensionChannel, createWebviewTransport } from '../../presentation/webview/typed_channel.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveSingleConfiguredPdfUri } from '../shared/command_input.js';
import {
  openConfigurePanel,
  startPdfConfigureSession,
  type ConfigureHostSchema,
  type ConfigureWebviewSchema,
} from './pdf_configure_session.js';
import { withCancellationSignal } from './progress_cancellation.js';
import type { ConversionCommandMessages } from './run_output_conversion.js';

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
  inputUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  prepared: Prepared;
  runtime: ConversionExecutionContext;
}

export interface RunSinglePdfConfigureOptions<
  HostSchema extends ConfigureHostSchema,
  WebviewSchema extends ConfigureWebviewSchema,
  Prepared,
> {
  context: vscode.ExtensionContext;
  sourceUris: vscode.Uri[];
  dependencies: CommandDependencies;
  commandId: string;
  pageId: WebviewPageId;
  panelId: string;
  panelTitle: string;
  protocol: MessageProtocol<HostSchema, WebviewSchema>;
  operationName: string;
  messages: ConversionCommandMessages;
  prepare: (params: SinglePdfConfigurePrepareParams) => Promise<Prepared>;
  buildInitPayload: (
    params: SinglePdfConfigureBuildInitParams<Prepared>,
  ) => Extract<v.InferOutput<HostSchema>, { type: 'init' }>['payload'];
  apply: (
    payload: Extract<v.InferOutput<WebviewSchema>, { type: 'apply' }>['payload'],
    params: SinglePdfConfigureApplyParams<Prepared>,
  ) => Promise<CommittedConversionOutput[]>;
  onPreviewLoadFailed: (message: v.InferOutput<WebviewSchema>, outputChannel?: LineOutputChannel) => void;
}

export async function runSinglePdfConfigureCommand<
  const HostSchema extends ConfigureHostSchema,
  const WebviewSchema extends ConfigureWebviewSchema,
  Prepared,
>(options: RunSinglePdfConfigureOptions<HostSchema, WebviewSchema, Prepared>): Promise<void> {
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

  const channel = createExtensionChannel(protocol, createWebviewTransport(configurePanel.webview));

  startPdfConfigureSession({
    panel: configurePanel,
    channel,
    operationName,
    messages,
    outputChannel,
    buildInitPayload: (panel) =>
      buildInitPayload({
        panel,
        inputUri,
        workspaceFolder,
        prepared,
        pdfJsAssetsRoot,
        configuration,
      }),
    apply: async (payload, { runtime }) => options.apply(payload, { inputUri, workspaceFolder, prepared, runtime }),
    onPreviewLoadFailed,
    extensionShutdown: { context },
  });
}
