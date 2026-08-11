import * as vscode from 'vscode';

import {
  insertionDocumentSelectors,
  insertionFormats,
  type InsertionFormat,
} from '../../edit_provider/insertion_format.js';
import { extensionIdentity } from '../../generated/extension_manifest.js';
import { localeMap } from '../../locale_map.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';
import { isAbortError } from '../../shared/error.js';
import {
  isTableEditorWebviewToHostMessage,
  type TableEditorFormat,
  type TableEditorHostToWebview,
  type TableEditorLabels,
  type TableEditorWebviewToHost,
} from '../../shared/protocols/table_editor_protocol.js';
import { startPdfConfigureSession } from '../lifecycle/pdf_configure_session.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { userMessage } from '../shared/user_messages.js';

type TableEditorInsertMessage = Extract<TableEditorWebviewToHost, { type: 'insert' }>;

interface InsertionTarget {
  editor: vscode.TextEditor;
}

export async function openTableEditorCommand(dependencies: CommandDependencies): Promise<void> {
  const outputChannel = dependencies.outputChannel;
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
  const outputChannel = dependencies.outputChannel;
  const extensionUri = vscode.extensions.getExtension(extensionIdentity.id)?.extensionUri;
  if (extensionUri === undefined) {
    throw new Error('Graphics Workbench extension URI could not be resolved.');
  }

  const target = captureInsertionTarget();
  const panelTitle = localeMap('webview.tableEditor.title');
  const appRoot = vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'table_editor');
  const webviewSharedAssetsRoot = getWebviewSharedAssetsRoot(extensionUri);

  startPdfConfigureSession({
    panel: {
      id: 'graphics-workbench.tableEditor',
      title: panelTitle,
      appRoot,
      localResourceRoots: [appRoot, webviewSharedAssetsRoot],
    },
    webview: {
      title: panelTitle,
      appName: 'table_editor',
      extensionUri,
      locale: vscode.env.language,
    },
    message: {
      isWebviewToHostMessage: isTableEditorWebviewToHostMessage,
      isApplyMessage: isTableEditorInsertMessage,
      buildInitMessage: () => buildTableEditorInitMessage({ format: initialFormatFor(target) }),
      runApply: async (message) => {
        await insertTableCode({ target, message, outputChannel });
      },
      onPreviewLoadFailed: (message, channel) => {
        channel?.appendLine(`[open-table-editor] unexpected message: ${JSON.stringify(message)}`);
      },
    },
    error: {
      operationName: 'open-table-editor',
      cancelledMessage: userMessage('message.tableEditor.cancelled'),
      failedMessage: (reason) => userMessage('message.tableEditor.applyFailed', reason),
    },
    outputChannel,
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

function isTableEditorInsertMessage(message: TableEditorWebviewToHost): message is TableEditorInsertMessage {
  return message.type === 'insert';
}

function buildTableEditorInitMessage(params: { format: TableEditorFormat }): TableEditorHostToWebview {
  return {
    type: 'init',
    payload: {
      format: params.format,
      labels: tableEditorLabels(),
    },
  };
}

async function insertTableCode(params: {
  target: InsertionTarget | undefined;
  message: TableEditorInsertMessage;
  outputChannel: LineOutputChannel;
}): Promise<void> {
  const { target, message, outputChannel } = params;
  if (target === undefined) {
    throw new Error(userMessage('message.tableEditor.noTarget'));
  }
  const { editor } = target;
  if (editor.document.isClosed) {
    throw new Error(userMessage('message.tableEditor.targetClosed'));
  }
  const succeeded = await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, message.payload.code);
  });
  if (!succeeded) {
    throw new Error(userMessage('message.tableEditor.targetNotModifiable'));
  }
  outputChannel.appendLine(`[open-table-editor] inserted ${message.payload.format} table.`);
  await vscode.window.showInformationMessage(userMessage('message.tableEditor.inserted'));
}

function tableEditorLabels(): TableEditorLabels {
  return {
    header: {
      title: localeMap('webview.tableEditor.header.title'),
      description: localeMap('webview.tableEditor.header.description'),
    },
    input: {
      unsupportedFile: localeMap('webview.tableEditor.input.unsupportedFile'),
      emptyFile: localeMap('webview.tableEditor.input.emptyFile'),
    },
    table: {
      addRow: localeMap('webview.tableEditor.table.addRow'),
      addColumn: localeMap('webview.tableEditor.table.addColumn'),
      removeRow: localeMap('webview.tableEditor.table.removeRow'),
      removeColumn: localeMap('webview.tableEditor.table.removeColumn'),
      alignmentLabel: localeMap('webview.tableEditor.table.alignmentLabel'),
      alignmentLeft: localeMap('webview.tableEditor.table.alignmentLeft'),
      alignmentCenter: localeMap('webview.tableEditor.table.alignmentCenter'),
      alignmentRight: localeMap('webview.tableEditor.table.alignmentRight'),
      headerToggle: localeMap('webview.tableEditor.table.headerToggle'),
    },
    options: {
      formatLabel: localeMap('webview.tableEditor.options.formatLabel'),
      formatLatex: localeMap('webview.tableEditor.options.formatLatex'),
      formatTypst: localeMap('webview.tableEditor.options.formatTypst'),
      formatQuarkdown: localeMap('webview.tableEditor.options.formatQuarkdown'),
      booktabs: localeMap('webview.tableEditor.options.booktabs'),
    },
    preview: {
      title: localeMap('webview.tableEditor.preview.title'),
    },
    actions: {
      insert: localeMap('webview.tableEditor.actions.insert'),
    },
  };
}
