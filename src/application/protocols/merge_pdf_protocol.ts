import {
  hasExactKeys,
  isNonEmptyString,
  isOptionalWebviewUri,
  isRecord,
  isString,
  isWebviewUri,
} from './protocol_utils.js';
import { isPdfPreviewSettings, type PdfPreviewSettings } from './pdf_preview_protocol.js';

export interface MergePdfSource {
  sourceId: string;
  fileName: string;
  pdfSrc: string;
}

export interface MergePdfLabels {
  header: {
    title: string;
    description: string;
  };
  sources: {
    list: string;
    listDescription: string;
    count: string;
  };
  controls: {
    actions: string;
    dragHandle: string;
    moveUp: string;
    moveDown: string;
    removeSource: string;
  };
  preview: {
    title: string;
    ariaLabel: string;
    loading: string;
    renderError: string;
  };
  actions: {
    apply: string;
    cancel: string;
  };
}

export type MergePdfHostToWebview =
  | {
      type: 'init';
      payload: {
        sources: MergePdfSource[];
        workerSrc?: string;
        cMapUrl?: string;
        standardFontDataUrl?: string;
        wasmUrl?: string;
        preview: PdfPreviewSettings;
        labels: MergePdfLabels;
      };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

export type MergePdfWebviewToHost =
  | { type: 'ready' }
  | {
      type: 'apply';
      payload: { sourceIds: string[] };
    }
  | { type: 'cancel' }
  | {
      type: 'previewLoadFailed';
      payload: { message: string };
    };

export function isMergePdfHostToWebviewMessage(value: unknown): value is MergePdfHostToWebview {
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

  return (
    hasExactKeys(value, ['type', 'payload']) &&
    hasExactKeys(
      value.payload,
      ['sources', 'preview', 'labels'],
      ['workerSrc', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl'],
    ) &&
    Array.isArray(value.payload.sources) &&
    value.payload.sources.length >= 2 &&
    value.payload.sources.every(isMergePdfSource) &&
    new Set(value.payload.sources.map((source) => source.sourceId)).size === value.payload.sources.length &&
    isOptionalWebviewUri(value.payload.workerSrc) &&
    isOptionalWebviewUri(value.payload.cMapUrl) &&
    isOptionalWebviewUri(value.payload.standardFontDataUrl) &&
    isOptionalWebviewUri(value.payload.wasmUrl) &&
    isPdfPreviewSettings(value.payload.preview) &&
    isMergePdfLabels(value.payload.labels)
  );
}

function isMergePdfLabels(value: unknown): value is MergePdfLabels {
  if (!isRecord(value)) {
    return false;
  }

  const groups = [
    ['header', ['title', 'description']],
    ['sources', ['list', 'listDescription', 'count']],
    ['controls', ['actions', 'dragHandle', 'moveUp', 'moveDown', 'removeSource']],
    ['preview', ['title', 'ariaLabel', 'loading', 'renderError']],
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

export function isMergePdfWebviewToHostMessage(value: unknown): value is MergePdfWebviewToHost {
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
    hasExactKeys(value.payload, ['sourceIds']) &&
    Array.isArray(value.payload.sourceIds) &&
    value.payload.sourceIds.length > 0 &&
    value.payload.sourceIds.every(isNonEmptyString)
  );
}

function isMergePdfSource(value: unknown): value is MergePdfSource {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['sourceId', 'fileName', 'pdfSrc']) &&
    isNonEmptyString(value.sourceId) &&
    isNonEmptyString(value.fileName) &&
    isWebviewUri(value.pdfSrc)
  );
}
