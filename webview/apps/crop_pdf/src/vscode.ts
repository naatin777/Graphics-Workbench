import { createVsCodeApi } from '@webview-shared/vscode';

import type { WebviewToExtensionMessage } from './messages';

export const vscode = createVsCodeApi<WebviewToExtensionMessage>();
