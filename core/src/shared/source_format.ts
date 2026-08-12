import path from 'node:path';

export type SourceFormat =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'avif'
  | 'gif'
  | 'tiff'
  | 'svg'
  | 'drawio'
  | 'editable-drawio-png'
  | 'editable-drawio-svg';

export const sourceFormatExtensions = {
  pdf: ['pdf'],
  png: ['png'],
  jpeg: ['jpg', 'jpeg'],
  webp: ['webp'],
  avif: ['avif'],
  gif: ['gif'],
  tiff: ['tif', 'tiff'],
  svg: ['svg'],
  drawio: ['drawio', 'dio'],
  'editable-drawio-png': ['drawio.png', 'dio.png'],
  'editable-drawio-svg': ['drawio.svg', 'dio.svg'],
} as const satisfies Record<SourceFormat, readonly string[]>;

const compoundSourceFormatSuffixes = Object.entries(sourceFormatExtensions).flatMap(([format, extensions]) =>
  isSourceFormat(format)
    ? extensions
        .filter((extension) => extension.includes('.'))
        .map((extension) => ({ format, suffix: `.${extension}` }))
    : [],
);
const sourceFormatByExtension: ReadonlyMap<string, SourceFormat> = new Map(
  Object.entries(sourceFormatExtensions).flatMap(([format, extensions]) => {
    if (!isSourceFormat(format)) {
      return [];
    }
    return extensions
      .filter((extension) => !extension.includes('.'))
      .map((extension) => [`.${extension}`, format] as const);
  }),
);
const rasterSourceFormats = new Set<SourceFormat>(['png', 'jpeg', 'webp', 'avif', 'gif', 'tiff']);

function isSourceFormat(value: string): value is SourceFormat {
  return value in sourceFormatExtensions;
}

export function sourceFormatForPath(sourcePath: string): SourceFormat | undefined {
  const lowerSourcePath = sourcePath.toLowerCase();
  for (const { format, suffix } of compoundSourceFormatSuffixes) {
    if (lowerSourcePath.endsWith(suffix)) {
      return format;
    }
  }

  return sourceFormatByExtension.get(path.extname(lowerSourcePath));
}

export function isRasterImagePath(sourcePath: string): boolean {
  const format = sourceFormatForPath(sourcePath);
  return isRasterFormat(format);
}

export function isSupportedPdfConversionSource(sourcePath: string): boolean {
  const format = sourceFormatForPath(sourcePath);
  return format !== undefined && format !== 'pdf' && format !== 'drawio';
}

/** Returns true when the resolved format is a raster image format. */
export function isRasterFormat(format: SourceFormat | undefined): boolean {
  return format !== undefined && rasterSourceFormats.has(format);
}

export function isSameSourceFormat(sourcePath: string, outputExtension: string): boolean {
  const sourceFormat = sourceFormatForPath(sourcePath);
  const normalizedExtension = outputExtension.toLowerCase().replace(/^\./u, '');
  let outputFormat = normalizedExtension;
  if (normalizedExtension === 'jpg' || normalizedExtension === 'jpeg') {
    outputFormat = 'jpeg';
  } else if (normalizedExtension === 'tif' || normalizedExtension === 'tiff') {
    outputFormat = 'tiff';
  }

  return sourceFormat === outputFormat;
}

export function isEditableDrawioImagePath(sourcePath: string): boolean {
  const format = sourceFormatForPath(sourcePath);
  return format === 'editable-drawio-png' || format === 'editable-drawio-svg';
}

export function isNativeDrawioPath(sourcePath: string): boolean {
  return sourceFormatForPath(sourcePath) === 'drawio';
}

export function isDrawioPath(sourcePath: string): boolean {
  return isNativeDrawioPath(sourcePath) || isEditableDrawioImagePath(sourcePath);
}

export function logicalSourcePathForOutputTemplate(sourcePath: string): string {
  if (!isEditableDrawioImagePath(sourcePath)) {
    return sourcePath;
  }

  return sourcePath.replace(/\.(drawio|dio)\.(png|svg)$/i, '');
}
