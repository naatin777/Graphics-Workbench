import { createPageProtocolClient } from '@webview-shared/vscode';
import { rotatePdfProtocol } from '@graphics-workbench-rotate-pdf-protocol';

export const vscode = createPageProtocolClient(rotatePdfProtocol);
