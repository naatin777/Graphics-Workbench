import { createConfiguration, type Configuration } from '../../src/generated-extension-meta.js';

export function fakeConfiguration(values: Record<string, unknown> = {}): Configuration {
  return createConfiguration({
    get(key: string): unknown {
      return values[key];
    },
  });
}
