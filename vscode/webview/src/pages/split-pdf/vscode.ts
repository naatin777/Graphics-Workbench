import { createPageProtocolClient } from '@webview-shared/vscode';
import { splitPdfProtocol } from '@graphics-workbench-split-pdf-protocol';

export const vscode = createPageProtocolClient(splitPdfProtocol);
