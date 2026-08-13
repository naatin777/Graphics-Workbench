import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';
import { MessageCatalogSchema, defineProtocol, type ProtocolMessage } from './typed_protocol.js';

const MergePdfSourceSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pdfSrc: WebviewUriSchema,
});
export type MergePdfSource = v.InferOutput<typeof MergePdfSourceSchema>;

const MergePdfInitPayloadSchema = v.strictObject({
  sources: v.pipe(
    v.array(MergePdfSourceSchema),
    v.minLength(2),
    v.check(
      (sources: MergePdfSource[]): boolean => new Set(sources.map((source) => source.sourceId)).size === sources.length,
    ),
  ),
  resources: PdfJsResourcesSchema,
  preview: PdfPreviewSettingsSchema,
  labels: MessageCatalogSchema,
});

const MergePdfHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: MergePdfInitPayloadSchema,
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);

const MergePdfWebviewToHostSchema = v.variant('type', [
  v.strictObject({ type: v.literal('ready') }),
  v.strictObject({ type: v.literal('cancel') }),
  v.strictObject({
    type: v.literal('apply'),
    payload: v.strictObject({
      sourceIds: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.minLength(1)),
    }),
  }),
  v.strictObject({
    type: v.literal('previewLoadFailed'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export const mergePdfProtocol = defineProtocol({
  hostToWebview: MergePdfHostToWebviewSchema,
  webviewToHost: MergePdfWebviewToHostSchema,
});

export type MergePdfHostToWebview = ProtocolMessage<typeof mergePdfProtocol, 'hostToWebview'>;
export type MergePdfWebviewToHost = ProtocolMessage<typeof mergePdfProtocol, 'webviewToHost'>;
