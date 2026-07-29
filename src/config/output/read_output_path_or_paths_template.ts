import type { Configuration } from '../../generated-extension-meta.js';
import { resolveOutputPathTemplate, resolveOutputPathsTemplate, type OutputPathKey } from './output_path_settings.js';

export function resolveOutputPathOrPathsTemplate(
  configuration: Configuration,
  key: OutputPathKey,
  setting: () => string,
  fallback?: string,
  defaultSetting: () => string = setting,
): string {
  const pageTemplate = resolveOutputPathsTemplate(configuration, key, '');
  if (pageTemplate !== '') {
    return pageTemplate;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return resolveOutputPathTemplate(setting(), defaultSetting());
}
