import { readOutputPathTemplate, readOutputPathsTemplate } from './output_path_settings.js';

export function readOutputPathOrPathsTemplate(
  configuration: { get<T>(key: string, defaultValue: T): T },
  key: string,
  defaultValue: string,
): string {
  const pageTemplate = readOutputPathsTemplate(configuration, key, '');
  return pageTemplate || readOutputPathTemplate(configuration, `outputPath.${key}`, defaultValue);
}
