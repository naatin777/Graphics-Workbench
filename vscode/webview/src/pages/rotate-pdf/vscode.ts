import { createPageProtocolClient } from '@webview-shared/vscode';
import { rotatePdfProtocol } from '@graphics-workbench/vscode-protocol/rotate-pdf-protocol';

export const vscode = createPageProtocolClient(rotatePdfProtocol);
