import * as v from 'valibot';
import { PdfPreviewSettingsSchema } from './pdf_preview_protocol.js';
import { defineProtocol, type ProtocolMessage } from './typed_protocol.js';

const PreviewFormatSchema = v.union([v.literal('pdf'), v.literal('tiff')]);
export type PreviewFormat = v.InferOutput<typeof PreviewFormatSchema>;

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

const PreviewResourcesSchema = v.strictObject({
  workerSrc: v.optional(v.string()),
  cMapUrl: v.optional(v.string()),
  standardFontDataUrl: v.optional(v.string()),
  wasmUrl: v.optional(v.string()),
});

const previewHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: v.strictObject({
      format: PreviewFormatSchema,
      fileName: v.string(),
      pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
      pdfData: v.optional(v.string()),
      resources: PreviewResourcesSchema,
      preview: PdfPreviewSettingsSchema,
      labels: PreviewLabelsSchema,
    }),
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

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isPreviewWebviewToHostMessage(value: unknown): value is PreviewWebviewToHost {
  return previewProtocol.parseWebviewToHost(value) !== undefined;
}

// oxlint-disable-next-line typescript/no-restricted-types -- Extension Hostから届く未検証JSONを検証する境界。
export function isPreviewHostToWebviewMessage(value: unknown): value is PreviewHostToWebview {
  return previewProtocol.parseHostToWebview(value) !== undefined;
}
