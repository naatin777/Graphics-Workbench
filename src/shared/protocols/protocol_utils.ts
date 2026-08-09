export function hasExactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);

  return requiredKeys.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowedKeys.has(key));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isWebviewUri(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const { protocol } = new URL(value);
    return protocol === 'vscode-resource:' || protocol === 'vscode-webview-resource:' || protocol === 'https:';
  } catch {
    return false;
  }
}
