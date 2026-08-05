import { hasExactKeys, isRecord, isString } from './protocol_utils.js';
import type { PdfPreviewSettings } from './pdf_preview_protocol.js';
import { isWebviewMessageWithPayload, isWebviewMessageWithoutPayload } from './webview_protocol.js';

export interface CropBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface PdfRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfPageRotation = 0 | 90 | 180 | 270;

export interface PdfPageGeometry {
  page: number;
  mediaBox: PdfRectangle;
  cropBox: PdfRectangle;
  rotation: PdfPageRotation;
}

export type CropTarget = { type: 'all' } | { type: 'selected'; pages: number[] };

export interface CropPdfLabels {
  header: {
    title: string;
    description: string;
    pageLabel: string;
    pages: string;
  };
  preview: {
    title: string;
    ariaLabel: string;
    zoomLabel: string;
    zoomOut: string;
    zoomIn: string;
    renderError: string;
    applyError: string;
  };
  cropBox: {
    settingsLabel: string;
    title: string;
    left: string;
    bottom: string;
    right: string;
    top: string;
    currentPageSize: string;
  };
  targetPages: {
    applyTo: string;
    all: string;
    pages: string;
    inputLabel: string;
    placeholder: string;
  };
  validation: {
    cropBoxNumber: string;
    cropBoxSize: string;
    pagesRequired: string;
    pageWholeNumber: string;
    pageOutOfRange: string;
  };
  actions: {
    apply: string;
    processing: string;
    cancel: string;
  };
}

export type CropConfigureHostToWebview =
  | {
      type: 'init';
      payload: {
        pdfSrc: string;
        resources: {
          workerSrc?: string;
          cMapUrl?: string;
          standardFontDataUrl?: string;
          wasmUrl?: string;
        };
        preview: PdfPreviewSettings;
        fileName: string;
        pageCount: number;
        initialPage: number;
        pageGeometry: PdfPageGeometry[];
        initialCropBox: CropBox;
        labels: CropPdfLabels;
      };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

export type CropConfigureWebviewToHost =
  | { type: 'ready' }
  | {
      type: 'apply';
      payload: { cropBox: CropBox; target: CropTarget };
    }
  | { type: 'cancel' }
  | {
      type: 'previewLoadFailed';
      payload: { message: string };
    };

export function isCropConfigureMessage(value: unknown): value is CropConfigureWebviewToHost {
  return (
    isWebviewMessageWithoutPayload(value, 'ready') ||
    isWebviewMessageWithoutPayload(value, 'cancel') ||
    isWebviewMessageWithPayload(value, 'previewLoadFailed', isCropMessagePayload) ||
    isWebviewMessageWithPayload(value, 'apply', isCropApplyPayload)
  );
}

function isCropMessagePayload(value: unknown): value is { message: string } {
  return isRecord(value) && hasExactKeys(value, ['message']) && isString(value.message);
}

function isCropApplyPayload(
  value: unknown,
): value is Extract<CropConfigureWebviewToHost, { type: 'apply' }>['payload'] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['cropBox', 'target']) &&
    isCropBox(value.cropBox) &&
    isCropTarget(value.target)
  );
}

function isCropBox(value: unknown): value is CropBox {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['left', 'bottom', 'right', 'top']) &&
    ['left', 'bottom', 'right', 'top'].every((key) => {
      const coordinate = value[key];
      return typeof coordinate === 'number' && Number.isFinite(coordinate);
    })
  );
}

function isCropTarget(value: unknown): value is CropTarget {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'all') {
    return hasExactKeys(value, ['type']);
  }

  return (
    value.type === 'selected' &&
    hasExactKeys(value, ['type', 'pages']) &&
    Array.isArray(value.pages) &&
    value.pages.every((page) => Number.isInteger(page) && page > 0)
  );
}
