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

export const PDF_ROTATION_ANGLES = [90, 180, 270] as const;
export type PdfRotationAngle = (typeof PDF_ROTATION_ANGLES)[number];

export interface RotatePdfLabels {
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
  rotation: {
    title: string;
    angleLabel: string;
    selectAll: string;
    selectAllAriaLabel: string;
    pageToggle: string;
  };
  validation: {
    pagesRequired: string;
    pageOutOfRange: string;
    angleInvalid: string;
  };
  actions: {
    apply: string;
    cancel: string;
  };
}

export type RotatePdfHostToWebview =
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
        labels: RotatePdfLabels;
      };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

export type RotatePdfWebviewToHost =
  | { type: 'ready' }
  | {
      type: 'apply';
      payload: {
        angle: PdfRotationAngle;
        /** 1-based page numbers to rotate. */
        pageIndices: number[];
      };
    }
  | { type: 'cancel' }
  | {
      type: 'previewLoadFailed';
      payload: { message: string };
    };

export function isRotatePdfHostToWebviewMessage(value: unknown): value is RotatePdfHostToWebview {
  return isWebviewErrorMessage(value) || isWebviewMessageWithPayload(value, 'init', isRotatePdfInitPayload);
}

function isRotatePdfInitPayload(value: unknown): value is Extract<RotatePdfHostToWebview, { type: 'init' }>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['sourceId', 'fileName', 'pageCount', 'pdfSrc', 'resources', 'preview', 'labels']) &&
    isNonEmptyString(value.sourceId) &&
    isNonEmptyString(value.fileName) &&
    isPositiveInteger(value.pageCount) &&
    isWebviewUri(value.pdfSrc) &&
    isRotatePdfResources(value.resources) &&
    isPdfPreviewSettings(value.preview) &&
    isRotatePdfLabels(value.labels)
  );
}

function isRotatePdfResources(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [], ['workerSrc', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl']) &&
    isOptionalWebviewUri(value.workerSrc) &&
    isOptionalWebviewUri(value.cMapUrl) &&
    isOptionalWebviewUri(value.standardFontDataUrl) &&
    isOptionalWebviewUri(value.wasmUrl)
  );
}

export function isRotatePdfWebviewToHostMessage(value: unknown): value is RotatePdfWebviewToHost {
  return (
    isWebviewMessageWithoutPayload(value, 'ready') ||
    isWebviewMessageWithoutPayload(value, 'cancel') ||
    isWebviewMessageWithPayload(value, 'previewLoadFailed', isRotatePdfMessagePayload) ||
    isWebviewMessageWithPayload(value, 'apply', isRotatePdfApplyPayload)
  );
}

function isRotatePdfMessagePayload(value: unknown): value is { message: string } {
  return isRecord(value) && hasExactKeys(value, ['message']) && isString(value.message);
}

function isRotatePdfApplyPayload(
  value: unknown,
): value is Extract<RotatePdfWebviewToHost, { type: 'apply' }>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['angle', 'pageIndices']) &&
    PDF_ROTATION_ANGLES.some((angle) => angle === value.angle) &&
    Array.isArray(value.pageIndices) &&
    value.pageIndices.length > 0 &&
    value.pageIndices.every(isPositiveInteger)
  );
}

function isRotatePdfLabels(value: unknown): value is RotatePdfLabels {
  if (!isRecord(value)) {
    return false;
  }

  const groups = [
    ['header', ['title', 'description']],
    ['preview', ['title', 'description', 'ariaLabel', 'renderError', 'applyError']],
    ['rotation', ['title', 'angleLabel', 'selectAll', 'selectAllAriaLabel', 'pageToggle']],
    ['validation', ['pagesRequired', 'pageOutOfRange', 'angleInvalid']],
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
