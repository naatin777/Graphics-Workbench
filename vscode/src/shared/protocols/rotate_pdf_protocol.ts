import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';

export const PDF_ROTATION_ANGLES = [90, 180, 270] as const;
export type PdfRotationAngle = (typeof PDF_ROTATION_ANGLES)[number];

const RotatePdfLabelsSchema = v.strictObject({
  header: v.strictObject({
    title: v.string(),
    description: v.string(),
  }),
  preview: v.strictObject({
    title: v.string(),
    description: v.string(),
    ariaLabel: v.string(),
    renderError: v.string(),
    applyError: v.string(),
  }),
  rotation: v.strictObject({
    title: v.string(),
    angleLabel: v.string(),
    selectAll: v.string(),
    selectAllAriaLabel: v.string(),
    pageToggle: v.string(),
  }),
  validation: v.strictObject({
    pagesRequired: v.string(),
    pageOutOfRange: v.string(),
    angleInvalid: v.string(),
  }),
  actions: v.strictObject({
    apply: v.string(),
    cancel: v.string(),
  }),
});
export type RotatePdfLabels = v.InferOutput<typeof RotatePdfLabelsSchema>;

const RotatePdfInitPayloadSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pdfSrc: WebviewUriSchema,
  resources: PdfJsResourcesSchema,
  preview: PdfPreviewSettingsSchema,
  labels: RotatePdfLabelsSchema,
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
export type RotatePdfHostToWebview = v.InferOutput<typeof RotatePdfHostToWebviewSchema>;

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
export type RotatePdfWebviewToHost = v.InferOutput<typeof RotatePdfWebviewToHostSchema>;

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isRotatePdfHostToWebviewMessage(value: unknown): value is RotatePdfHostToWebview {
  return v.is(RotatePdfHostToWebviewSchema, value);
}

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isRotatePdfWebviewToHostMessage(value: unknown): value is RotatePdfWebviewToHost {
  return v.is(RotatePdfWebviewToHostSchema, value);
}
