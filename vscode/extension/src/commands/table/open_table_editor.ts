import * as vscode from 'vscode';

import {
  insertionDocumentSelectors,
  insertionFormats,
  type InsertionFormat,
} from '../../edit_provider/insertion_format.js';
import { extensionIdentity } from '../../generated/extension_manifest.js';
import { localeCatalog, localeMap } from '../../locale_map.js';
import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import { getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';
import { createExtensionChannel, createWebviewTransport } from '../../presentation/webview/typed_channel.js';
import { isAbortError } from '@graphics-workbench/core/runtime';
import {
  tableEditorProtocol,
  type TableEditorFormat,
  type TableEditorHostToWebview,
  type TableEditorWebviewToHost,
} from '@graphics-workbench/vscode-protocol/table-editor-protocol';
import { openConfigurePanel } from '../lifecycle/pdf_configure_session.js';
import { reportConfigureApplyError } from '../shared/report_configure_error.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { userMessage } from '../shared/user_messages.js';

type TableEditorInsertPayload = Extract<TableEditorWebviewToHost, { type: 'insert' }>['payload'];

interface InsertionTarget {
  editor: vscode.TextEditor;
}

export async function openTableEditorCommand(dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  try {
    await runOpenTableEditorCommand(dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[open-table-editor] failure: ${message}`);
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.tableEditor.cancelled'));
      return;
    }
    await vscode.window.showErrorMessage(userMessage('message.tableEditor.openFailed', message));
  }
}

async function runOpenTableEditorCommand(dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  const extensionUri = vscode.extensions.getExtension(extensionIdentity.id)?.extensionUri;
  if (extensionUri === undefined) {
    throw new Error('Graphics Workbench extension URI could not be resolved.');
  }

  const target = captureInsertionTarget();
  const panelTitle = localeMap('webview.tableEditor.title');
  const appRoot = vscode.Uri.joinPath(extensionUri, 'media', 'webview');
  const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(extensionUri);

  const configurePanel = openConfigurePanel({
    panel: {
      id: 'graphics-workbench.tableEditor',
      title: panelTitle,
      localResourceRoots: [appRoot, webviewSharedAssetsRoot],
    },
    webview: {
      title: panelTitle,
      pageId: 'table-editor',
      extensionUri,
      locale: vscode.env.language,
    },
  });
  const extensionChannel = createExtensionChannel(tableEditorProtocol, createWebviewTransport(configurePanel.webview));
  let isInserting = false;
  const unsubscribe = extensionChannel.on({
    ready: () => {
      extensionChannel.send.init(buildTableEditorInitMessage({ format: initialFormatFor(target) }));
    },
    cancel: () => {
      configurePanel.dispose();
    },
    insert: (payload) => {
      if (isInserting) {
        return;
      }
      isInserting = true;
      void (async (): Promise<void> => {
        try {
          await insertTableCode({ target, payload, outputChannel });
        } catch (error) {
          await reportConfigureApplyError({
            operationName: 'open-table-editor',
            error,
            panel: configurePanel,
            cancelledMessage: userMessage('message.tableEditor.cancelled'),
            failedMessage: (reason) => userMessage('message.tableEditor.applyFailed', reason),
            outputChannel,
            sendError: (message) => {
              extensionChannel.send.error({ message });
            },
          });
        } finally {
          isInserting = false;
        }
      })();
    },
  });
  configurePanel.onDidDispose(() => {
    unsubscribe();
  });
}

function captureInsertionTarget(): InsertionTarget | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return undefined;
  }
  return { editor };
}

/** 既存のInsertionFormat仕組みを逆引きして、文書言語から初期出力形式を決める。 */
function initialFormatFor(target: InsertionTarget | undefined): TableEditorFormat {
  if (target === undefined) {
    return 'latex';
  }
  return insertionFormatForDocument(target.editor.document) ?? 'latex';
}

/** insertionDocumentSelectorsを逆引きし、documentのlanguageIdに一致するInsertionFormatを返す。 */
function insertionFormatForDocument(document: vscode.TextDocument): InsertionFormat | undefined {
  for (const format of insertionFormats) {
    if (vscode.languages.match(insertionDocumentSelectors[format], document) > 0) {
      return format;
    }
  }
  return undefined;
}

function buildTableEditorInitMessage(params: {
  format: TableEditorFormat;
}): Extract<TableEditorHostToWebview, { type: 'init' }>['payload'] {
  return {
    format: params.format,
    labels: localeCatalog(),
  };
}

async function insertTableCode(params: {
  target: InsertionTarget | undefined;
  payload: TableEditorInsertPayload;
  outputChannel: LineOutputChannel;
}): Promise<void> {
  const { target, payload, outputChannel } = params;
  if (target === undefined) {
    throw new Error(userMessage('message.tableEditor.noTarget'));
  }
  const { editor } = target;
  if (editor.document.isClosed) {
    throw new Error(userMessage('message.tableEditor.targetClosed'));
  }
  const succeeded = await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, payload.code);
  });
  if (!succeeded) {
    throw new Error(userMessage('message.tableEditor.targetNotModifiable'));
  }
  outputChannel.appendLine(`[open-table-editor] inserted ${payload.format} table.`);
  await vscode.window.showInformationMessage(userMessage('message.tableEditor.inserted'));
}
