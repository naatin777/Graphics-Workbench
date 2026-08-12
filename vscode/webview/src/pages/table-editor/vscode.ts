import { createPageProtocolClient } from '@webview-shared/vscode';
import { tableEditorProtocol } from '@graphics-workbench-table-editor-protocol';

export const vscode = createPageProtocolClient(tableEditorProtocol);
