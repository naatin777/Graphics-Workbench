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

export interface SplitPdfLabels {
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
    allPages: string;
    focusedPages: string;
    zoom: string;
  };
  groups: {
    title: string;
    label: string;
    add: string;
    remove: string;
    drag: string;
    outputOrder: string;
  };
  pages: {
    title: string;
    label: string;
    placeholder: string;
  };
  output: {
    name: string;
    namePlaceholder: string;
    path: string;
  };
  validation: {
    pagesRequired: string;
    pageWholeNumber: string;
    pageOutOfRange: string;
    invalidPages: string;
    descendingPages: string;
    outputNameEmpty: string;
    outputNamePath: string;
    outputNameDuplicate: string;
  };
  actions: {
    apply: string;
    cancel: string;
    moveUp: string;
    moveDown: string;
  };
}

export type SplitPdfHostToWebview =
  | {
      type: 'init';
      payload: {
        sourceId: string;
        fileName: string;
        pageCount: number;
        pdfSrc: string;
        outputPathTemplate: string;
        resources: {
          workerSrc?: string;
          cMapUrl?: string;
          standardFontDataUrl?: string;
          wasmUrl?: string;
        };
        preview: PdfPreviewSettings;
        labels: SplitPdfLabels;
      };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

export interface SplitPdfPageGroupRow {
  pages: number[];
  outputName: string;
}

type SplitPdfPageParseFailureKind = 'required' | 'malformed' | 'wholeNumber' | 'descending' | 'outOfRange';

export type SplitPdfPageParseFailure = {
  ok: false;
  kind: SplitPdfPageParseFailureKind;
  token: string;
};

export type SplitPdfPageParseResult = { ok: true; pages: number[] } | SplitPdfPageParseFailure;

export function parseSplitPdfPages(raw: string, pageCount: number): SplitPdfPageParseResult {
  if (raw.trim().length === 0) {
    return { ok: false, kind: 'required', token: raw };
  }

  const pages: number[] = [];

  for (const rawToken of raw.split(',')) {
    const token = rawToken.trim();

    if (token.length === 0) {
      return { ok: false, kind: 'malformed', token: rawToken };
    }

    if (/^\d+$/.test(token)) {
      const page = Number(token);

      if (!Number.isSafeInteger(page)) {
        return { ok: false, kind: 'wholeNumber', token };
      }

      if (page < 1 || page > pageCount) {
        return { ok: false, kind: 'outOfRange', token };
      }

      pages.push(page);
      continue;
    }

    const range = /^(\d+)\s*-\s*(\d*)$/.exec(token) ?? /^-\s*(\d+)$/.exec(token);

    if (!range) {
      return { ok: false, kind: token.includes('.') ? 'wholeNumber' : 'malformed', token };
    }

    const isLeadingOpenRange = token.startsWith('-');
    const start = Number(isLeadingOpenRange ? '1' : range[1]);
    const rangeEnd = range[2] === '' ? pageCount.toString() : range[2];
    const end = Number(isLeadingOpenRange ? range[1] : rangeEnd);

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return { ok: false, kind: 'wholeNumber', token };
    }

    if (end < start) {
      return { ok: false, kind: 'descending', token };
    }

    if (start < 1 || end > pageCount) {
      return { ok: false, kind: 'outOfRange', token };
    }

    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }
  }

  return { ok: true, pages };
}

export type SplitPdfWebviewToHost =
  | { type: 'ready' }
  | {
      type: 'apply';
      payload: { rows: SplitPdfPageGroupRow[] };
    }
  | { type: 'cancel' }
  | {
      type: 'previewLoadFailed';
      payload: { message: string };
    };

export function isSplitPdfHostToWebviewMessage(value: unknown): value is SplitPdfHostToWebview {
  return isWebviewErrorMessage(value) || isWebviewMessageWithPayload(value, 'init', isSplitPdfInitPayload);
}

function isSplitPdfInitPayload(value: unknown): value is Extract<SplitPdfHostToWebview, { type: 'init' }>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, [
      'sourceId',
      'fileName',
      'pageCount',
      'pdfSrc',
      'outputPathTemplate',
      'resources',
      'preview',
      'labels',
    ]) &&
    isNonEmptyString(value.sourceId) &&
    isNonEmptyString(value.fileName) &&
    isPositiveInteger(value.pageCount) &&
    isWebviewUri(value.pdfSrc) &&
    isNonEmptyString(value.outputPathTemplate) &&
    isSplitPdfResources(value.resources) &&
    isPdfPreviewSettings(value.preview) &&
    isSplitPdfLabels(value.labels)
  );
}

function isSplitPdfResources(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [], ['workerSrc', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl']) &&
    isOptionalWebviewUri(value.workerSrc) &&
    isOptionalWebviewUri(value.cMapUrl) &&
    isOptionalWebviewUri(value.standardFontDataUrl) &&
    isOptionalWebviewUri(value.wasmUrl)
  );
}

export function isSplitPdfWebviewToHostMessage(value: unknown): value is SplitPdfWebviewToHost {
  return (
    isWebviewMessageWithoutPayload(value, 'ready') ||
    isWebviewMessageWithoutPayload(value, 'cancel') ||
    isWebviewMessageWithPayload(value, 'previewLoadFailed', isSplitPdfMessagePayload) ||
    isWebviewMessageWithPayload(value, 'apply', isSplitPdfApplyPayload)
  );
}

function isSplitPdfMessagePayload(value: unknown): value is { message: string } {
  return isRecord(value) && hasExactKeys(value, ['message']) && isString(value.message);
}

function isSplitPdfApplyPayload(value: unknown): value is Extract<SplitPdfWebviewToHost, { type: 'apply' }>['payload'] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['rows']) &&
    Array.isArray(value.rows) &&
    value.rows.length > 0 &&
    value.rows.every(isSplitPdfPageGroupRow)
  );
}

function isSplitPdfLabels(value: unknown): value is SplitPdfLabels {
  if (!isRecord(value)) {
    return false;
  }

  const groups = [
    ['header', ['title', 'description']],
    ['preview', ['title', 'description', 'ariaLabel', 'renderError', 'applyError', 'allPages', 'focusedPages', 'zoom']],
    ['groups', ['title', 'label', 'add', 'remove', 'drag', 'outputOrder']],
    ['pages', ['title', 'label', 'placeholder']],
    ['output', ['name', 'namePlaceholder', 'path']],
    [
      'validation',
      [
        'pagesRequired',
        'pageWholeNumber',
        'pageOutOfRange',
        'invalidPages',
        'descendingPages',
        'outputNameEmpty',
        'outputNamePath',
        'outputNameDuplicate',
      ],
    ],
    ['actions', ['apply', 'cancel', 'moveUp', 'moveDown']],
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

function isSplitPdfPageGroupRow(value: unknown): value is SplitPdfPageGroupRow {
  if (!isRecord(value) || !hasExactKeys(value, ['pages', 'outputName'])) {
    return false;
  }

  return (
    Array.isArray(value.pages) &&
    value.pages.length > 0 &&
    value.pages.every(isPositiveInteger) &&
    isNonEmptyString(value.outputName)
  );
}
