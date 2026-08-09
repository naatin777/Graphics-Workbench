import * as v from 'valibot';

export const PdfPreviewSettingsSchema = v.strictObject({
  maxCanvasPixels: v.pipe(v.number(), v.integer(), v.minValue(1_000_000)),
  maxDevicePixelRatio: v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(8)),
});

export type PdfPreviewSettings = v.InferOutput<typeof PdfPreviewSettingsSchema>;
