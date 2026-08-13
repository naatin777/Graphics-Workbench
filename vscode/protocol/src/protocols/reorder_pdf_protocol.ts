import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';
import { MessageCatalogSchema, defineProtocol, type ProtocolMessage } from './typed_protocol.js';

const ReorderPdfInitPayloadSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pdfSrc: WebviewUriSchema,
  resources: PdfJsResourcesSchema,
  preview: PdfPreviewSettingsSchema,
  labels: MessageCatalogSchema,
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
export const reorderPdfProtocol = defineProtocol({
  hostToWebview: ReorderPdfHostToWebviewSchema,
  webviewToHost: ReorderPdfWebviewToHostSchema,
});

export type ReorderPdfHostToWebview = ProtocolMessage<typeof reorderPdfProtocol, 'hostToWebview'>;
export type ReorderPdfWebviewToHost = ProtocolMessage<typeof reorderPdfProtocol, 'webviewToHost'>;
