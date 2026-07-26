type ConfigurationReader = {
  get<T>(key: string, defaultValue: T): T;
};

export function readOutputPathTemplate(configuration: ConfigurationReader, key: string, defaultValue: string): string {
  const template = configuration.get<unknown>(key, defaultValue);
  return typeof template === 'string' && template.trim() !== '' ? template : defaultValue;
}

export function readOutputPathsTemplate(configuration: ConfigurationReader, key: string, defaultValue: string): string {
  const outputPaths = configuration.get<unknown>('outputPaths', {});
  if (outputPaths === null || typeof outputPaths !== 'object' || Array.isArray(outputPaths)) {
    return defaultValue;
  }

  const template = (outputPaths as Record<string, unknown>)[key];
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
