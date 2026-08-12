import { createPageProtocolClient } from '@webview-shared/vscode';
import { previewProtocol } from '@graphics-workbench-preview-protocol';

export const vscode = createPageProtocolClient(previewProtocol);
