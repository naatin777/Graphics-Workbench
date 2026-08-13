import { createPageProtocolClient } from '@webview-shared/vscode';
import { reorderPdfProtocol } from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';

export const vscode = createPageProtocolClient(reorderPdfProtocol);
