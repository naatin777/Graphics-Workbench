import * as v from 'valibot';
import { PdfPreviewSettingsSchema } from './pdf_preview_protocol.js';

const PdfPageRotationSchema = v.union([v.literal(0), v.literal(90), v.literal(180), v.literal(270)]);
export type PdfPageRotation = v.InferOutput<typeof PdfPageRotationSchema>;

const PdfRectangleSchema = v.strictObject({
  x: v.pipe(v.number(), v.finite()),
  y: v.pipe(v.number(), v.finite()),
  width: v.pipe(v.number(), v.finite()),
  height: v.pipe(v.number(), v.finite()),
});
export type PdfRectangle = v.InferOutput<typeof PdfRectangleSchema>;

const PdfPageGeometrySchema = v.strictObject({
  page: v.pipe(v.number(), v.integer(), v.minValue(1)),
  mediaBox: PdfRectangleSchema,
  cropBox: PdfRectangleSchema,
  rotation: PdfPageRotationSchema,
});
export type PdfPageGeometry = v.InferOutput<typeof PdfPageGeometrySchema>;

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

const CropPdfLabelsSchema = v.strictObject({
  header: v.strictObject({
    title: v.string(),
    description: v.string(),
    pageLabel: v.string(),
    pages: v.string(),
  }),
  preview: v.strictObject({
    title: v.string(),
    ariaLabel: v.string(),
    zoomLabel: v.string(),
    zoomOut: v.string(),
    zoomIn: v.string(),
    renderError: v.string(),
    applyError: v.string(),
  }),
  cropBox: v.strictObject({
    settingsLabel: v.string(),
    title: v.string(),
    left: v.string(),
    bottom: v.string(),
    right: v.string(),
    top: v.string(),
    currentPageSize: v.string(),
  }),
  targetPages: v.strictObject({
    applyTo: v.string(),
    all: v.string(),
    pages: v.string(),
    inputLabel: v.string(),
    placeholder: v.string(),
  }),
  validation: v.strictObject({
    cropBoxNumber: v.string(),
    cropBoxSize: v.string(),
    pagesRequired: v.string(),
    pageWholeNumber: v.string(),
    pageOutOfRange: v.string(),
  }),
  actions: v.strictObject({
    apply: v.string(),
    processing: v.string(),
    cancel: v.string(),
  }),
});
export type CropPdfLabels = v.InferOutput<typeof CropPdfLabelsSchema>;

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
      labels: CropPdfLabelsSchema,
    }),
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export type CropConfigureHostToWebview = v.InferOutput<typeof CropConfigureHostToWebviewSchema>;

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
export type CropConfigureWebviewToHost = v.InferOutput<typeof CropConfigureWebviewToHostSchema>;

export function isCropConfigureMessage(value: unknown): value is CropConfigureWebviewToHost {
  return v.is(CropConfigureWebviewToHostSchema, value);
}
