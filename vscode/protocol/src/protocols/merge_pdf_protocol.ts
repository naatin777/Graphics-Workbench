import * as v from 'valibot';
import { PdfJsResourcesSchema, PdfPreviewSettingsSchema, WebviewUriSchema } from './pdf_preview_protocol.js';
import { defineProtocol, type ProtocolMessage } from './typed_protocol.js';

const MergePdfSourceSchema = v.strictObject({
  sourceId: v.pipe(v.string(), v.nonEmpty()),
  fileName: v.pipe(v.string(), v.nonEmpty()),
  pdfSrc: WebviewUriSchema,
});
export type MergePdfSource = v.InferOutput<typeof MergePdfSourceSchema>;

const MergePdfLabelsSchema = v.strictObject({
  header: v.strictObject({
    title: v.string(),
  }),
  sources: v.strictObject({
    list: v.string(),
    count: v.string(),
  }),
  controls: v.strictObject({
    actions: v.string(),
    dragHandle: v.string(),
    moveUp: v.string(),
    moveDown: v.string(),
    removeSource: v.string(),
  }),
  preview: v.strictObject({
    title: v.string(),
    ariaLabel: v.string(),
    loading: v.string(),
    renderError: v.string(),
  }),
  actions: v.strictObject({
    apply: v.string(),
    cancel: v.string(),
  }),
});
export type MergePdfLabels = v.InferOutput<typeof MergePdfLabelsSchema>;

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
  labels: MergePdfLabelsSchema,
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

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isMergePdfHostToWebviewMessage(value: unknown): value is MergePdfHostToWebview {
  return mergePdfProtocol.parseHostToWebview(value) !== undefined;
}

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isMergePdfWebviewToHostMessage(value: unknown): value is MergePdfWebviewToHost {
  return mergePdfProtocol.parseWebviewToHost(value) !== undefined;
}
