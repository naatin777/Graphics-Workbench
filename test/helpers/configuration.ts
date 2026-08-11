import { createConfiguration, type Configuration } from '../../vscode/src/generated/extension_manifest.js';

export function fakeConfiguration(values: Record<string, unknown> = {}): Configuration {
  return createConfiguration({
    get(key: string): unknown {
      return values[key];
    },
  });
}
