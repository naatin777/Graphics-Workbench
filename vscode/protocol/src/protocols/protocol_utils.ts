// oxlint-disable-next-line typescript/no-restricted-types -- 未検証外部入力のURIを検証する型ガード。
export function isWebviewUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  try {
    const { protocol } = new URL(value);
    // http: はVite dev serverから配信されるbrowser開発用fixtureでのみ使われる。
    // ProductionのExtension Hostは常にvscode-resource:を送るため、緩和はdev専用。
    return (
      protocol === 'vscode-resource:' ||
      protocol === 'vscode-webview-resource:' ||
      protocol === 'https:' ||
      protocol === 'http:'
    );
  } catch {
    return false;
  }
}
