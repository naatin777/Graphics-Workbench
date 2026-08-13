import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';
import { MessageCatalogSchema, defineProtocol, type ProtocolMessage } from './typed_protocol.js';

export const PDF_ROTATION_ANGLES = [90, 180, 270] as const;
export type PdfRotationAngle = (typeof PDF_ROTATION_ANGLES)[number];

const RotatePdfInitPayloadSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pdfSrc: WebviewUriSchema,
  resources: PdfJsResourcesSchema,
  preview: PdfPreviewSettingsSchema,
  labels: MessageCatalogSchema,
});

const RotatePdfHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: RotatePdfInitPayloadSchema,
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);

const PdfRotationAngleSchema = v.union(PDF_ROTATION_ANGLES.map((angle) => v.literal(angle)));

const RotatePdfWebviewToHostSchema = v.variant('type', [
  v.strictObject({ type: v.literal('ready') }),
  v.strictObject({ type: v.literal('cancel') }),
  v.strictObject({
    type: v.literal('apply'),
    payload: v.strictObject({
      angle: PdfRotationAngleSchema,
      pageIndices: v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(1))), v.minLength(1)),
    }),
  }),
  v.strictObject({
    type: v.literal('previewLoadFailed'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export const rotatePdfProtocol = defineProtocol({
  hostToWebview: RotatePdfHostToWebviewSchema,
  webviewToHost: RotatePdfWebviewToHostSchema,
});

export type RotatePdfHostToWebview = ProtocolMessage<typeof rotatePdfProtocol, 'hostToWebview'>;
export type RotatePdfWebviewToHost = ProtocolMessage<typeof rotatePdfProtocol, 'webviewToHost'>;
