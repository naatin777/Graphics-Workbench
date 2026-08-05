import {
  hasExactKeys,
  isNonEmptyString,
  isOptionalWebviewUri,
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

export interface MergePdfSource {
  sourceId: string;
  fileName: string;
  pdfSrc: string;
}

export interface MergePdfLabels {
  header: {
    title: string;
  };
  sources: {
    list: string;
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
  return isWebviewErrorMessage(value) || isWebviewMessageWithPayload(value, 'init', isMergePdfInitPayload);
}

function isMergePdfInitPayload(value: unknown): value is Extract<MergePdfHostToWebview, { type: 'init' }>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['sources', 'preview', 'labels'], ['workerSrc', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl']) &&
    Array.isArray(value.sources) &&
    value.sources.length >= 2 &&
    value.sources.every(isMergePdfSource) &&
    new Set(value.sources.map((source) => source.sourceId)).size === value.sources.length &&
    isOptionalWebviewUri(value.workerSrc) &&
    isOptionalWebviewUri(value.cMapUrl) &&
    isOptionalWebviewUri(value.standardFontDataUrl) &&
    isOptionalWebviewUri(value.wasmUrl) &&
    isPdfPreviewSettings(value.preview) &&
    isMergePdfLabels(value.labels)
  );
}

function isMergePdfLabels(value: unknown): value is MergePdfLabels {
  if (!isRecord(value)) {
    return false;
  }

  const groups = [
    ['header', ['title']],
    ['sources', ['list', 'count']],
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
  return (
    isWebviewMessageWithoutPayload(value, 'ready') ||
    isWebviewMessageWithoutPayload(value, 'cancel') ||
    isWebviewMessageWithPayload(value, 'previewLoadFailed', isMergePdfMessagePayload) ||
    isWebviewMessageWithPayload(value, 'apply', isMergePdfApplyPayload)
  );
}

function isMergePdfMessagePayload(value: unknown): value is { message: string } {
  return isRecord(value) && hasExactKeys(value, ['message']) && isString(value.message);
}

function isMergePdfApplyPayload(value: unknown): value is Extract<MergePdfWebviewToHost, { type: 'apply' }>['payload'] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['sourceIds']) &&
    Array.isArray(value.sourceIds) &&
    value.sourceIds.length > 0 &&
    value.sourceIds.every(isNonEmptyString)
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
