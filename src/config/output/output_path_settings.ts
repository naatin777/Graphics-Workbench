export type ConfigurationReader = {
  get(key: string, defaultValue: unknown): unknown;
};

export function readOutputPathTemplate(configuration: ConfigurationReader, key: string, defaultValue: string): string {
  const template = configuration.get(key, defaultValue);
  return typeof template === 'string' && template.trim() !== '' ? template : defaultValue;
}

export function readOutputPathsTemplate(configuration: ConfigurationReader, key: string, defaultValue: string): string {
  const outputPaths = configuration.get('outputPaths', {});
  if (outputPaths === null || typeof outputPaths !== 'object' || Array.isArray(outputPaths)) {
    return defaultValue;
  }

  const template = Reflect.get(outputPaths, key);
  return typeof template === 'string' && template.trim() !== '' ? template : defaultValue;
}

const EXTENSION_TO_FORMAT: Record<string, string> = {
  '.png': 'Png',
  '.jpg': 'Jpeg',
  '.jpeg': 'Jpeg',
  '.webp': 'Webp',
  '.avif': 'Avif',
  '.gif': 'Gif',
  '.tiff': 'Tiff',
  '.tif': 'Tiff',
};

export function readConvertToRawOutputPath(
  configuration: ConfigurationReader,
  sourceExtension: string,
  defaultValue: string,
): string {
  const format = EXTENSION_TO_FORMAT[sourceExtension.toLowerCase()];
  if (format) {
    return readOutputPathsTemplate(configuration, `convert${format}ToRaw`, defaultValue);
  }
  return readOutputPathsTemplate(configuration, 'convertToRaw', defaultValue);
}
