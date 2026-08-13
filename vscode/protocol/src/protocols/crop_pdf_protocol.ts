import * as v from 'valibot';
import { PdfPreviewSettingsSchema } from './pdf_preview_protocol.js';
import { MessageCatalogSchema, defineProtocol, type ProtocolMessage } from './typed_protocol.js';

const PdfPageRotationSchema = v.union([v.literal(0), v.literal(90), v.literal(180), v.literal(270)]);

const PdfRectangleSchema = v.strictObject({
  x: v.pipe(v.number(), v.finite()),
  y: v.pipe(v.number(), v.finite()),
  width: v.pipe(v.number(), v.finite()),
  height: v.pipe(v.number(), v.finite()),
});

const PdfPageGeometrySchema = v.strictObject({
  page: v.pipe(v.number(), v.integer(), v.minValue(1)),
  mediaBox: PdfRectangleSchema,
  cropBox: PdfRectangleSchema,
  rotation: PdfPageRotationSchema,
});

const CropBoxSchema = v.strictObject({
  left: v.pipe(v.number(), v.finite()),
  bottom: v.pipe(v.number(), v.finite()),
  right: v.pipe(v.number(), v.finite()),
  top: v.pipe(v.number(), v.finite()),
});
export type CropBox = v.InferOutput<typeof CropBoxSchema>;

const CropTargetSchema = v.variant('type', [
  v.strictObject({ type: v.literal('all') }),
  v.strictObject({
    type: v.literal('selected'),
    pages: v.array(v.pipe(v.number(), v.integer(), v.minValue(1))),
  }),
]);
export type CropTarget = v.InferOutput<typeof CropTargetSchema>;

const CropPdfResourcesSchema = v.strictObject({
  workerSrc: v.string(),
  cMapUrl: v.string(),
  standardFontDataUrl: v.string(),
  wasmUrl: v.string(),
});

const CropConfigureHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: v.strictObject({
      pdfSrc: v.string(),
      resources: CropPdfResourcesSchema,
      preview: PdfPreviewSettingsSchema,
      fileName: v.string(),
      pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
      initialPage: v.pipe(v.number(), v.integer(), v.minValue(1)),
      pageGeometry: v.array(PdfPageGeometrySchema),
      initialCropBox: CropBoxSchema,
      labels: MessageCatalogSchema,
    }),
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);

const CropConfigureWebviewToHostSchema = v.variant('type', [
  v.strictObject({ type: v.literal('ready') }),
  v.strictObject({ type: v.literal('cancel') }),
  v.strictObject({
    type: v.literal('apply'),
    payload: v.strictObject({
      cropBox: CropBoxSchema,
      target: CropTargetSchema,
    }),
  }),
  v.strictObject({
    type: v.literal('previewLoadFailed'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export const cropPdfProtocol = defineProtocol({
  hostToWebview: CropConfigureHostToWebviewSchema,
  webviewToHost: CropConfigureWebviewToHostSchema,
});

export type CropConfigureHostToWebview = ProtocolMessage<typeof cropPdfProtocol, 'hostToWebview'>;
export type CropConfigureWebviewToHost = ProtocolMessage<typeof cropPdfProtocol, 'webviewToHost'>;
