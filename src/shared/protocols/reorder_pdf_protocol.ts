import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';

const ReorderPdfLabelsSchema = v.strictObject({
  header: v.strictObject({
    title: v.string(),
    description: v.string(),
  }),
  preview: v.strictObject({
    title: v.string(),
    ariaLabel: v.string(),
    renderError: v.string(),
    applyError: v.string(),
  }),
  order: v.strictObject({
    title: v.string(),
    moveUp: v.string(),
    moveDown: v.string(),
    positionLabel: v.string(),
  }),
  validation: v.strictObject({
    orderRequired: v.string(),
    orderInvalid: v.string(),
  }),
  actions: v.strictObject({
    apply: v.string(),
    cancel: v.string(),
  }),
});
export type ReorderPdfLabels = v.InferOutput<typeof ReorderPdfLabelsSchema>;

const ReorderPdfInitPayloadSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pdfSrc: WebviewUriSchema,
  resources: PdfJsResourcesSchema,
  preview: PdfPreviewSettingsSchema,
  labels: ReorderPdfLabelsSchema,
});

const ReorderPdfHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: ReorderPdfInitPayloadSchema,
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export type ReorderPdfHostToWebview = v.InferOutput<typeof ReorderPdfHostToWebviewSchema>;

const ReorderPdfWebviewToHostSchema = v.variant('type', [
  v.strictObject({ type: v.literal('ready') }),
  v.strictObject({ type: v.literal('cancel') }),
  v.strictObject({
    type: v.literal('apply'),
    payload: v.strictObject({
      order: v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(1))), v.minLength(1)),
    }),
  }),
  v.strictObject({
    type: v.literal('previewLoadFailed'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export type ReorderPdfWebviewToHost = v.InferOutput<typeof ReorderPdfWebviewToHostSchema>;

export function isReorderPdfHostToWebviewMessage(value: unknown): value is ReorderPdfHostToWebview {
  return v.is(ReorderPdfHostToWebviewSchema, value);
}

export function isReorderPdfWebviewToHostMessage(value: unknown): value is ReorderPdfWebviewToHost {
  return v.is(ReorderPdfWebviewToHostSchema, value);
}
