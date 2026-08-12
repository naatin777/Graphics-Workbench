import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';
import { defineProtocol, type ProtocolMessage } from './typed_protocol.js';

export {
  parsePdfPageSelection as parseSplitPdfPages,
  type PdfPageSelectionParseFailure as SplitPdfPageParseFailure,
} from '@graphics-workbench/core/formats';

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

const SplitPdfInitPayloadSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pdfSrc: WebviewUriSchema,
  outputPathTemplate: v.pipe(v.string(), v.nonEmpty()),
  resources: PdfJsResourcesSchema,
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
export const splitPdfProtocol = defineProtocol({
  hostToWebview: SplitPdfHostToWebviewSchema,
  webviewToHost: SplitPdfWebviewToHostSchema,
});

export type SplitPdfHostToWebview = ProtocolMessage<typeof splitPdfProtocol, 'hostToWebview'>;
export type SplitPdfWebviewToHost = ProtocolMessage<typeof splitPdfProtocol, 'webviewToHost'>;

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isSplitPdfHostToWebviewMessage(value: unknown): value is SplitPdfHostToWebview {
  return splitPdfProtocol.parseHostToWebview(value) !== undefined;
}

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isSplitPdfWebviewToHostMessage(value: unknown): value is SplitPdfWebviewToHost {
  return splitPdfProtocol.parseWebviewToHost(value) !== undefined;
}
