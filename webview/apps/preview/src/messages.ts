import type { PreviewHostToWebview, PreviewWebviewToHost } from '@graphics-workbench-preview-protocol';

export type { PreviewLabels } from '@graphics-workbench-preview-protocol';

export type ExtensionToWebviewMessage = PreviewHostToWebview;
export type WebviewToExtensionMessage = PreviewWebviewToHost;

export type PreviewInitPayload = Extract<ExtensionToWebviewMessage, { type: 'init' }>['payload'];
