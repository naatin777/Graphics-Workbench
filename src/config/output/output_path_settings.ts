import { configs, type ConfigurationReader, type OutputPaths } from '../../generated-extension-meta.js';

export type OutputPathKey = keyof OutputPaths;

function isOutputPaths(value: unknown): value is OutputPaths {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveOutputPathsTemplate(
  configuration: ConfigurationReader,
  key: OutputPathKey,
  defaultValue: string,
): string {
  const outputPaths = configs.outputPaths(configuration);
  if (!isOutputPaths(outputPaths)) {
    return defaultValue;
  }
  const template = outputPaths[key];
  return typeof template === 'string' && template.trim() !== '' ? template : defaultValue;
}

const extensionToFormat: Record<string, 'Png' | 'Jpeg' | 'Webp' | 'Avif' | 'Gif' | 'Tiff'> = {
  '.png': 'Png',
  '.jpg': 'Jpeg',
  '.jpeg': 'Jpeg',
  '.webp': 'Webp',
  '.avif': 'Avif',
  '.gif': 'Gif',
  '.tiff': 'Tiff',
  '.tif': 'Tiff',
};

const rawOutputPathKeys: Record<
  'Png' | 'Jpeg' | 'Webp' | 'Avif' | 'Gif' | 'Tiff',
  | 'convertPngToRaw'
  | 'convertJpegToRaw'
  | 'convertWebpToRaw'
  | 'convertAvifToRaw'
  | 'convertGifToRaw'
  | 'convertTiffToRaw'
> = {
  Png: 'convertPngToRaw',
  Jpeg: 'convertJpegToRaw',
  Webp: 'convertWebpToRaw',
  Avif: 'convertAvifToRaw',
  Gif: 'convertGifToRaw',
  Tiff: 'convertTiffToRaw',
};

export function readConvertToRawOutputPath(
  configuration: ConfigurationReader,
  sourceExtension: string,
  defaultValue: string,
): string {
  const format = extensionToFormat[sourceExtension.toLowerCase()];
  if (format !== undefined) {
    return resolveOutputPathsTemplate(configuration, rawOutputPathKeys[format], defaultValue);
  }
  return defaultValue;
}
