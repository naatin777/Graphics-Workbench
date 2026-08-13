import type { PreviewHostToWebview } from '@graphics-workbench/vscode-protocol/preview-protocol';

export type { PreviewLabels } from '@graphics-workbench/vscode-protocol/preview-protocol';

export type ExtensionToWebviewMessage = PreviewHostToWebview;

export type PreviewInitPayload = Extract<ExtensionToWebviewMessage, { type: 'init' }>['payload'];
