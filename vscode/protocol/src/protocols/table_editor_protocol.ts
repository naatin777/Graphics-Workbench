import * as v from 'valibot';
import { MessageCatalogSchema, defineProtocol, type ProtocolMessage } from './typed_protocol.js';

const TABLE_EDITOR_FORMATS = ['latex', 'typst', 'quarkdown'] as const;
export type TableEditorFormat = (typeof TABLE_EDITOR_FORMATS)[number];

const TableEditorFormatSchema = v.union(TABLE_EDITOR_FORMATS.map((format) => v.literal(format)));

const TableEditorInitPayloadSchema = v.strictObject({
  format: TableEditorFormatSchema,
  labels: MessageCatalogSchema,
});

const TableEditorHostToWebviewSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('init'),
    payload: TableEditorInitPayloadSchema,
  }),
  v.strictObject({
    type: v.literal('error'),
    payload: v.strictObject({ message: v.string() }),
  }),
]);

const TableEditorWebviewToHostSchema = v.variant('type', [
  v.strictObject({ type: v.literal('ready') }),
  v.strictObject({ type: v.literal('cancel') }),
  v.strictObject({
    type: v.literal('insert'),
    payload: v.strictObject({
      format: TableEditorFormatSchema,
      code: v.string(),
    }),
  }),
]);
export const tableEditorProtocol = defineProtocol({
  hostToWebview: TableEditorHostToWebviewSchema,
  webviewToHost: TableEditorWebviewToHostSchema,
});

export type TableEditorHostToWebview = ProtocolMessage<typeof tableEditorProtocol, 'hostToWebview'>;
export type TableEditorWebviewToHost = ProtocolMessage<typeof tableEditorProtocol, 'webviewToHost'>;
