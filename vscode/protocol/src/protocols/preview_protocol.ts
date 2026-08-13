import * as v from 'valibot';
import { PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';
import { defineProtocol, type ProtocolMessage } from './typed_protocol.js';

export const PREVIEW_FORMATS = ['pdf', 'tiff'] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];

const PreviewLabelsSchema = v.strictObject({
  title: v.string(),
  description: v.string(),
  page: v.strictObject({
    label: v.string(),
    pages: v.string(),
  }),
  preview: v.strictObject({
    ariaLabel: v.string(),
    zoomLabel: v.string(),
    zoomOut: v.string(),
    zoomIn: v.string(),
    renderError: v.string(),
  }),
});
export type PreviewLabels = v.InferOutput<typeof PreviewLabelsSchema>;

const PreviewPdfResourcesSchema = v.strictObject({
  workerSrc: v.string(),
  cMapUrl: v.string(),
  standardFontDataUrl: v.string(),
  wasmUrl: v.string(),
});

const PreviewCommonInitSchema = v.strictObject({
  fileName: v.string(),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  preview: PdfPreviewSettingsSchema,
  labels: PreviewLabelsSchema,
});

const previewPdfInitSchema = v.strictObject({
  format: v.literal('pdf'),
  ...PreviewCommonInitSchema.entries,
  pdfSrc: WebviewUriSchema,
  resources: PreviewPdfResourcesSchema,
});

const previewTiffInitSchema = v.strictObject({
  format: v.literal('tiff'),
  ...PreviewCommonInitSchema.entries,
});

const previewHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: v.variant('format', [previewPdfInitSchema, previewTiffInitSchema]),
  }),
  v.strictObject({
    type: v.literal('renderPageResult'),
    payload: v.strictObject({
      page: v.pipe(v.number(), v.integer(), v.minValue(1)),
      dataUri: v.string(),
    }),
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
const previewWebviewToHostSchema = v.variant('type', [
  v.strictObject({ type: v.literal('ready') }),
  v.strictObject({ type: v.literal('cancel') }),
  v.strictObject({
    type: v.literal('renderPage'),
    payload: v.strictObject({
      page: v.pipe(v.number(), v.integer(), v.minValue(1)),
    }),
  }),
  v.strictObject({
    type: v.literal('previewLoadFailed'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);
export const previewProtocol = defineProtocol({
  hostToWebview: previewHostToWebviewSchema,
  webviewToHost: previewWebviewToHostSchema,
});

export type PreviewHostToWebview = ProtocolMessage<typeof previewProtocol, 'hostToWebview'>;
export type PreviewWebviewToHost = ProtocolMessage<typeof previewProtocol, 'webviewToHost'>;
