import {
  hasExactKeys,
  isNonEmptyString,
  isOptionalWebviewUri,
  isPositiveInteger,
  isRecord,
  isString,
  isWebviewUri,
} from './protocol_utils.js';

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
    hasExactKeys(value.payload, [
      'sourceId',
      'fileName',
      'pageCount',
      'pdfSrc',
      'outputPathTemplate',
      'resources',
      'labels',
    ]) &&
    isNonEmptyString(value.payload.sourceId) &&
    isNonEmptyString(value.payload.fileName) &&
    isPositiveInteger(value.payload.pageCount) &&
    isWebviewUri(value.payload.pdfSrc) &&
    isNonEmptyString(value.payload.outputPathTemplate) &&
    isRecord(value.payload.resources) &&
    hasExactKeys(value.payload.resources, [], ['workerSrc', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl']) &&
    isOptionalWebviewUri(value.payload.resources.workerSrc) &&
    isOptionalWebviewUri(value.payload.resources.cMapUrl) &&
    isOptionalWebviewUri(value.payload.resources.standardFontDataUrl) &&
    isOptionalWebviewUri(value.payload.resources.wasmUrl) &&
    isSplitPdfLabels(value.payload.labels)
  );
}

export function isSplitPdfWebviewToHostMessage(value: unknown): value is SplitPdfWebviewToHost {
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
    hasExactKeys(value.payload, ['rows']) &&
    Array.isArray(value.payload.rows) &&
    value.payload.rows.length > 0 &&
    value.payload.rows.every(isSplitPdfPageGroupRow)
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
