import * as v from 'valibot';
import { isWebviewUri } from './protocol_utils.js';

export const WebviewUriSchema = v.pipe(
  v.string(),
  v.check((value: string): boolean => isWebviewUri(value)),
);

export const PdfJsResourcesSchema = v.strictObject({
  workerSrc: WebviewUriSchema,
  cMapUrl: WebviewUriSchema,
  standardFontDataUrl: WebviewUriSchema,
  wasmUrl: WebviewUriSchema,
});

export type PdfJsResources = v.InferOutput<typeof PdfJsResourcesSchema>;

export const PdfPreviewSettingsSchema = v.strictObject({
  maxCanvasPixels: v.pipe(v.number(), v.integer(), v.minValue(1_000_000)),
  maxDevicePixelRatio: v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(8)),
});

export type PdfPreviewSettings = v.InferOutput<typeof PdfPreviewSettingsSchema>;
