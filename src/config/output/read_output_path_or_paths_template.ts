import type { ConfigurationReader } from '../../generated-extension-meta.js';
import { resolveOutputPathsTemplate, type OutputPathKey } from './output_path_settings.js';

export function resolveOutputPathOrPathsTemplate(
  configuration: ConfigurationReader,
  key: OutputPathKey,
  setting: () => string,
  fallback?: string,
): string {
  const pageTemplate = resolveOutputPathsTemplate(configuration, key, '');
  if (pageTemplate !== '') {
    return pageTemplate;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return setting();
}
