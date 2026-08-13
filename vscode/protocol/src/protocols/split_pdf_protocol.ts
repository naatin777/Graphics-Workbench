import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';
import { MessageCatalogSchema, defineProtocol, type ProtocolMessage } from './typed_protocol.js';

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
  labels: MessageCatalogSchema,
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
