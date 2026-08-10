// oxlint-disable-next-line typescript/no-restricted-types -- webview/child processから届く未検証値をオブジェクトとして検証する型ガード。
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// oxlint-disable-next-line typescript/no-restricted-types -- 未検証外部入力のURIを検証する型ガード。
export function isWebviewUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  try {
    const { protocol } = new URL(value);
    return protocol === 'vscode-resource:' || protocol === 'vscode-webview-resource:' || protocol === 'https:';
  } catch {
    return false;
  }
}
