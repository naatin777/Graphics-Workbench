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
