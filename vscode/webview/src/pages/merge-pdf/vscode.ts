import { createPageProtocolClient } from '@webview-shared/vscode';
import { mergePdfProtocol } from '@graphics-workbench/vscode-protocol/merge-pdf-protocol';

export const vscode = createPageProtocolClient(mergePdfProtocol);
