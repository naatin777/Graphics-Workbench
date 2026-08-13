import { createPageProtocolClient } from '@webview-shared/vscode';
import { previewProtocol } from '@graphics-workbench/vscode-protocol/preview-protocol';

export const vscode = createPageProtocolClient(previewProtocol);
