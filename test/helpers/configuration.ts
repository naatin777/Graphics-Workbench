import type { ConfigurationReader } from '../../src/generated-extension-meta.js';

export function fakeConfiguration(values: Record<string, unknown> = {}): ConfigurationReader {
  return {
    get<T>(key: string, _defaultValue?: T): T | undefined {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Test doubles model VS Code's dynamic configuration API.
      return values[key] as T | undefined;
    },
  };
}
