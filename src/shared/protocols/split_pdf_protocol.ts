import * as v from 'valibot';
import { isWebviewUri } from './protocol_utils.js';
import { PdfPreviewSettingsSchema } from './pdf_preview_protocol.js';

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

const SplitPdfLabelsSchema = v.strictObject({
  header: v.strictObject({
    title: v.string(),
    description: v.string(),
  }),
  preview: v.strictObject({
    title: v.string(),
    ariaLabel: v.string(),
    renderError: v.string(),
    applyError: v.string(),
    allPages: v.string(),
    focusedPages: v.string(),
    zoom: v.string(),
  }),
  groups: v.strictObject({
    title: v.string(),
    label: v.string(),
    add: v.string(),
    remove: v.string(),
    drag: v.string(),
    outputOrder: v.string(),
  }),
  pages: v.strictObject({
    title: v.string(),
    label: v.string(),
    placeholder: v.string(),
  }),
  output: v.strictObject({
    name: v.string(),
    namePlaceholder: v.string(),
    path: v.string(),
  }),
  validation: v.strictObject({
    pagesRequired: v.string(),
    pageWholeNumber: v.string(),
    pageOutOfRange: v.string(),
    invalidPages: v.string(),
    descendingPages: v.string(),
    outputNameEmpty: v.string(),
    outputNamePath: v.string(),
    outputNameDuplicate: v.string(),
  }),
  actions: v.strictObject({
    apply: v.string(),
    cancel: v.string(),
    moveUp: v.string(),
    moveDown: v.string(),
  }),
});
export type SplitPdfLabels = v.InferOutput<typeof SplitPdfLabelsSchema>;

const SplitPdfPageGroupRowSchema = v.strictObject({
  pages: v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(1))), v.minLength(1)),
  outputName: v.pipe(v.string(), v.nonEmpty()),
});
export type SplitPdfPageGroupRow = v.InferOutput<typeof SplitPdfPageGroupRowSchema>;

const SplitPdfWebviewUriSchema = v.pipe(
  v.string(),
  v.check((value: string): boolean => isWebviewUri(value)),
);

const SplitPdfResourcesSchema = v.strictObject({
  workerSrc: SplitPdfWebviewUriSchema,
  cMapUrl: SplitPdfWebviewUriSchema,
  standardFontDataUrl: SplitPdfWebviewUriSchema,
  wasmUrl: SplitPdfWebviewUriSchema,
});

const SplitPdfInitPayloadSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pdfSrc: SplitPdfWebviewUriSchema,
  outputPathTemplate: v.pipe(v.string(), v.nonEmpty()),
  resources: SplitPdfResourcesSchema,
  preview: PdfPreviewSettingsSchema,
  labels: SplitPdfLabelsSchema,
});

const SplitPdfHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: SplitPdfInitPayloadSchema,
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export type SplitPdfHostToWebview = v.InferOutput<typeof SplitPdfHostToWebviewSchema>;

const SplitPdfWebviewToHostSchema = v.variant('type', [
  v.strictObject({ type: v.literal('ready') }),
  v.strictObject({ type: v.literal('cancel') }),
  v.strictObject({
    type: v.literal('apply'),
    payload: v.strictObject({
      rows: v.pipe(v.array(SplitPdfPageGroupRowSchema), v.minLength(1)),
    }),
  }),
  v.strictObject({
    type: v.literal('previewLoadFailed'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export type SplitPdfWebviewToHost = v.InferOutput<typeof SplitPdfWebviewToHostSchema>;

export function isSplitPdfHostToWebviewMessage(value: unknown): value is SplitPdfHostToWebview {
  return v.is(SplitPdfHostToWebviewSchema, value);
}

export function isSplitPdfWebviewToHostMessage(value: unknown): value is SplitPdfWebviewToHost {
  return v.is(SplitPdfWebviewToHostSchema, value);
}
