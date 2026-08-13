export const WEBVIEW_PAGE_IDS = [
  'crop-pdf',
  'merge-pdf',
  'preview',
  'reorder-pdf',
  'rotate-pdf',
  'split-pdf',
  'table-editor',
] as const;

export type WebviewPageId = (typeof WEBVIEW_PAGE_IDS)[number];

// oxlint-disable-next-line typescript/no-restricted-types -- 起動時のpage idは未検証外部入力の境界。
export function isWebviewPageId(value: unknown): value is WebviewPageId {
  return typeof value === 'string' && (WEBVIEW_PAGE_IDS as readonly string[]).includes(value);
}
