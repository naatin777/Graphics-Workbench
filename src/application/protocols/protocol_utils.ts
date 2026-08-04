export function hasExactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);

  return requiredKeys.every((key) => key in value) && keys.every((key) => allowedKeys.has(key));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

export function isOptionalWebviewUri(value: unknown): value is string | undefined {
  return value === undefined || isWebviewUri(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
