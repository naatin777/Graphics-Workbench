import type { PreviewHostToWebview } from '@graphics-workbench-preview-protocol';

export type { PreviewLabels } from '@graphics-workbench-preview-protocol';

export type ExtensionToWebviewMessage = PreviewHostToWebview;

export type PreviewInitPayload = Extract<ExtensionToWebviewMessage, { type: 'init' }>['payload'];
