import { hasExactKeys, isPositiveInteger, isRecord, isString } from './protocol_utils.js';
import { isWebviewMessageWithPayload, isWebviewMessageWithoutPayload } from './webview_protocol.js';
import type { PdfPreviewSettings } from './pdf_preview_protocol.js';

export type PreviewFormat = 'pdf' | 'tiff';

export interface PreviewLabels {
  title: string;
  description: string;
  page: {
    label: string;
    pages: string;
  };
  preview: {
    ariaLabel: string;
    zoomLabel: string;
    zoomOut: string;
    zoomIn: string;
    renderError: string;
  };
}

export type PreviewHostToWebview =
  | {
      type: 'init';
      payload: {
        format: PreviewFormat;
        fileName: string;
        pageCount: number;
        pdfData?: string;
        resources: {
          workerSrc?: string;
          cMapUrl?: string;
          standardFontDataUrl?: string;
          wasmUrl?: string;
        };
        preview: PdfPreviewSettings;
        labels: PreviewLabels;
      };
    }
  | {
      type: 'renderPageResult';
      payload: { page: number; dataUri: string };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

export type PreviewWebviewToHost =
  | { type: 'ready' }
  | { type: 'cancel' }
  | {
      type: 'renderPage';
      payload: { page: number };
    }
  | {
      type: 'previewLoadFailed';
      payload: { message: string };
    };

export function isPreviewWebviewToHostMessage(value: unknown): value is PreviewWebviewToHost {
  return (
    isWebviewMessageWithoutPayload(value, 'ready') ||
    isWebviewMessageWithoutPayload(value, 'cancel') ||
    isWebviewMessageWithPayload(value, 'renderPage', isRenderPagePayload) ||
    isWebviewMessageWithPayload(value, 'previewLoadFailed', isPreviewMessagePayload)
  );
}

function isRenderPagePayload(
  value: unknown,
): value is Extract<PreviewWebviewToHost, { type: 'renderPage' }>['payload'] {
  return isRecord(value) && hasExactKeys(value, ['page']) && isPositiveInteger(value.page);
}

function isPreviewMessagePayload(value: unknown): value is { message: string } {
  return isRecord(value) && hasExactKeys(value, ['message']) && isString(value.message);
}
