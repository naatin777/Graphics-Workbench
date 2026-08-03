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

  return isRotatePdfInitPayload(value.payload);
}

function isRotatePdfInitPayload(payload: Record<string, unknown>): boolean {
  return (
    hasExactKeys(payload, ['sourceId', 'fileName', 'pageCount', 'pdfSrc', 'resources', 'preview', 'labels']) &&
    isNonEmptyString(payload.sourceId) &&
    isNonEmptyString(payload.fileName) &&
    isPositiveInteger(payload.pageCount) &&
    isWebviewUri(payload.pdfSrc) &&
    isRotatePdfResources(payload.resources) &&
    isPdfPreviewSettings(payload.preview) &&
    isRotatePdfLabels(payload.labels)
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

  return isRotatePdfApplyPayload(value.payload);
}

function isRotatePdfApplyPayload(payload: Record<string, unknown>): boolean {
  return (
    hasExactKeys(payload, ['angle', 'pageIndices']) &&
    PDF_ROTATION_ANGLES.some((angle) => angle === payload.angle) &&
    Array.isArray(payload.pageIndices) &&
    payload.pageIndices.length > 0 &&
    payload.pageIndices.every(isPositiveInteger)
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
