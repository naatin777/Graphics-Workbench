import {
  hasExactKeys,
  isNonEmptyString,
  isOptionalWebviewUri,
  isPositiveInteger,
  isRecord,
  isString,
  isWebviewUri,
} from './protocol_utils.js';
import { isPdfPreviewSettings, type PdfPreviewSettings } from './pdf_preview_protocol.js';

export interface ReorderPdfLabels {
  header: {
    title: string;
    description: string;
  };
  preview: {
    title: string;
    description: string;
    ariaLabel: string;
    renderError: string;
    applyError: string;
  };
  order: {
    title: string;
    moveUp: string;
    moveDown: string;
    positionLabel: string;
  };
  validation: {
    orderRequired: string;
    orderInvalid: string;
  };
  actions: {
    apply: string;
    cancel: string;
  };
}

export type ReorderPdfHostToWebview =
  | {
      type: 'init';
      payload: {
        sourceId: string;
        fileName: string;
        pageCount: number;
        pdfSrc: string;
        resources: {
          workerSrc?: string;
          cMapUrl?: string;
          standardFontDataUrl?: string;
          wasmUrl?: string;
        };
        preview: PdfPreviewSettings;
        labels: ReorderPdfLabels;
      };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

export type ReorderPdfWebviewToHost =
  | { type: 'ready' }
  | {
      type: 'apply';
      payload: {
        /** 1-based page numbers in the desired output order. */
        order: number[];
      };
    }
  | { type: 'cancel' }
  | {
      type: 'previewLoadFailed';
      payload: { message: string };
    };

export function isReorderPdfHostToWebviewMessage(value: unknown): value is ReorderPdfHostToWebview {
  if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.payload)) {
    return false;
  }

  if (value.type === 'error') {
    return (
      hasExactKeys(value, ['type', 'payload']) &&
      hasExactKeys(value.payload, ['message']) &&
      isString(value.payload.message)
    );
  }

  if (value.type !== 'init') {
    return false;
  }

  return isReorderPdfInitPayload(value.payload);
}

function isReorderPdfInitPayload(payload: Record<string, unknown>): boolean {
  return (
    hasExactKeys(payload, ['sourceId', 'fileName', 'pageCount', 'pdfSrc', 'resources', 'preview', 'labels']) &&
    isNonEmptyString(payload.sourceId) &&
    isNonEmptyString(payload.fileName) &&
    isPositiveInteger(payload.pageCount) &&
    isWebviewUri(payload.pdfSrc) &&
    isReorderPdfResources(payload.resources) &&
    isPdfPreviewSettings(payload.preview) &&
    isReorderPdfLabels(payload.labels)
  );
}

function isReorderPdfResources(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [], ['workerSrc', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl']) &&
    isOptionalWebviewUri(value.workerSrc) &&
    isOptionalWebviewUri(value.cMapUrl) &&
    isOptionalWebviewUri(value.standardFontDataUrl) &&
    isOptionalWebviewUri(value.wasmUrl)
  );
}

export function isReorderPdfWebviewToHostMessage(value: unknown): value is ReorderPdfWebviewToHost {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'ready' || value.type === 'cancel') {
    return hasExactKeys(value, ['type']);
  }

  if (value.type === 'previewLoadFailed') {
    return (
      hasExactKeys(value, ['type', 'payload']) &&
      isRecord(value.payload) &&
      hasExactKeys(value.payload, ['message']) &&
      isString(value.payload.message)
    );
  }

  if (value.type !== 'apply' || !hasExactKeys(value, ['type', 'payload']) || !isRecord(value.payload)) {
    return false;
  }

  return (
    hasExactKeys(value.payload, ['order']) &&
    Array.isArray(value.payload.order) &&
    value.payload.order.length > 0 &&
    value.payload.order.every(isPositiveInteger)
  );
}

function isReorderPdfLabels(value: unknown): value is ReorderPdfLabels {
  if (!isRecord(value)) {
    return false;
  }

  const groups = [
    ['header', ['title', 'description']],
    ['preview', ['title', 'description', 'ariaLabel', 'renderError', 'applyError']],
    ['order', ['title', 'moveUp', 'moveDown', 'positionLabel']],
    ['validation', ['orderRequired', 'orderInvalid']],
    ['actions', ['apply', 'cancel']],
  ] as const;

  if (
    !hasExactKeys(
      value,
      groups.map(([group]) => group),
    )
  ) {
    return false;
  }

  return groups.every(([groupName, keys]) => {
    const group = value[groupName];
    return isRecord(group) && hasExactKeys(group, keys) && keys.every((key) => isString(group[key]));
  });
}
