import { createPageProtocolClient } from '@webview-shared/vscode';
import { cropPdfProtocol } from '@graphics-workbench-crop-pdf-protocol';

export const vscode = createPageProtocolClient(cropPdfProtocol);
