import * as v from 'valibot';

const TABLE_EDITOR_FORMATS = ['latex', 'typst', 'quarkdown'] as const;
export type TableEditorFormat = (typeof TABLE_EDITOR_FORMATS)[number];

const TableEditorFormatSchema = v.union(TABLE_EDITOR_FORMATS.map((format) => v.literal(format)));

const TableEditorLabelsSchema = v.strictObject({
  header: v.strictObject({
    title: v.string(),
    description: v.string(),
  }),
  input: v.strictObject({
    unsupportedFile: v.string(),
    emptyFile: v.string(),
  }),
  table: v.strictObject({
    addRow: v.string(),
    addColumn: v.string(),
    removeRow: v.string(),
    removeColumn: v.string(),
    alignmentLabel: v.string(),
    alignmentLeft: v.string(),
    alignmentCenter: v.string(),
    alignmentRight: v.string(),
    headerToggle: v.string(),
  }),
  options: v.strictObject({
    formatLabel: v.string(),
    formatLatex: v.string(),
    formatTypst: v.string(),
    formatQuarkdown: v.string(),
    booktabs: v.string(),
  }),
  preview: v.strictObject({
    title: v.string(),
  }),
  actions: v.strictObject({
    insert: v.string(),
  }),
});
export type TableEditorLabels = v.InferOutput<typeof TableEditorLabelsSchema>;

const TableEditorInitPayloadSchema = v.strictObject({
  format: TableEditorFormatSchema,
  labels: TableEditorLabelsSchema,
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
export type TableEditorHostToWebview = v.InferOutput<typeof TableEditorHostToWebviewSchema>;

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
export type TableEditorWebviewToHost = v.InferOutput<typeof TableEditorWebviewToHostSchema>;

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isTableEditorHostToWebviewMessage(value: unknown): value is TableEditorHostToWebview {
  return v.is(TableEditorHostToWebviewSchema, value);
}

// oxlint-disable-next-line typescript/no-restricted-types -- webviewから届く未検証JSONを検証する境界。
export function isTableEditorWebviewToHostMessage(value: unknown): value is TableEditorWebviewToHost {
  return v.is(TableEditorWebviewToHostSchema, value);
}
