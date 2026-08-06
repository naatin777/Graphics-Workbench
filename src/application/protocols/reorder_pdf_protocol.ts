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
import {
  isWebviewErrorMessage,
  isWebviewMessageWithPayload,
  isWebviewMessageWithoutPayload,
} from './webview_protocol.js';

export interface ReorderPdfLabels {
  header: {
    title: string;
    description: string;
  };
  preview: {
    title: string;
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
  tooManyPages: string;
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
  return isWebviewErrorMessage(value) || isWebviewMessageWithPayload(value, 'init', isReorderPdfInitPayload);
}

function isReorderPdfInitPayload(
  value: unknown,
): value is Extract<ReorderPdfHostToWebview, { type: 'init' }>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['sourceId', 'fileName', 'pageCount', 'pdfSrc', 'resources', 'preview', 'labels']) &&
    isNonEmptyString(value.sourceId) &&
    isNonEmptyString(value.fileName) &&
    isPositiveInteger(value.pageCount) &&
    isWebviewUri(value.pdfSrc) &&
    isReorderPdfResources(value.resources) &&
    isPdfPreviewSettings(value.preview) &&
    isReorderPdfLabels(value.labels)
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
  return (
    isWebviewMessageWithoutPayload(value, 'ready') ||
    isWebviewMessageWithoutPayload(value, 'cancel') ||
    isWebviewMessageWithPayload(value, 'previewLoadFailed', isReorderPdfMessagePayload) ||
    isWebviewMessageWithPayload(value, 'apply', isReorderPdfApplyPayload)
  );
}

function isReorderPdfMessagePayload(value: unknown): value is { message: string } {
  return isRecord(value) && hasExactKeys(value, ['message']) && isString(value.message);
}

function isReorderPdfApplyPayload(
  value: unknown,
): value is Extract<ReorderPdfWebviewToHost, { type: 'apply' }>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['order']) &&
    Array.isArray(value.order) &&
    value.order.length > 0 &&
    value.order.every(isPositiveInteger)
  );
}

function isReorderPdfLabels(value: unknown): value is ReorderPdfLabels {
  if (!isRecord(value)) {
    return false;
  }

  const groups = [
    ['header', ['title', 'description']],
    ['preview', ['title', 'ariaLabel', 'renderError', 'applyError']],
    ['order', ['title', 'moveUp', 'moveDown', 'positionLabel']],
    ['validation', ['orderRequired', 'orderInvalid']],
    ['actions', ['apply', 'cancel']],
  ] as const;

  if (!hasExactKeys(value, [...groups.map(([group]) => group), 'tooManyPages'])) {
    return false;
  }

  return (
    isString(value.tooManyPages) &&
    groups.every(([groupName, keys]) => {
      const group = value[groupName];
      return isRecord(group) && hasExactKeys(group, keys) && keys.every((key) => isString(group[key]));
    })
  );
}
