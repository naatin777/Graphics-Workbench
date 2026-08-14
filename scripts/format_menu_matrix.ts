import {
  DRAWIO_IMAGE_FORMATS,
  RASTER_FORMATS,
  SOURCE_FORMATS,
  sourceFormatExtensions,
  type SourceFormat,
} from '../core/src/shared/source_format.ts';

const extensionFormats = SOURCE_FORMATS;
const drawioImageFormats = DRAWIO_IMAGE_FORMATS;
const nativeImageFormats = [...RASTER_FORMATS, 'svg'] as const;
const rasterFormats = RASTER_FORMATS;

const contextMenuEnabled = 'config.graphics-workbench.contextMenu.enabled';
const singleEnabled = 'config.graphics-workbench.conversion.single.enabled';
const splitEnabled = 'config.graphics-workbench.conversion.split.enabled';
const combineEnabled = 'config.graphics-workbench.conversion.combine.enabled';
const compoundDrawioMatch = String.raw`resourceFilename =~ /\.(drawio|dio)\.(png|svg)$/i`;

function isDrawioImageFormat(format: SourceFormat): format is (typeof drawioImageFormats)[number] {
  return drawioImageFormats.some((drawioImageFormat) => drawioImageFormat === format);
}

function extensionPattern(formats: readonly SourceFormat[]): string {
  const extensions = formats.flatMap((format) => sourceFormatExtensions[format]);
  return extensions.join('|');
}

function nativeExtensionMatch(
  formats: readonly SourceFormat[],
  options: { excludeDrawioImages?: boolean } = {},
): string | undefined {
  const nativeFormats = formats.filter((format) => !isDrawioImageFormat(format));
  if (nativeFormats.length === 0) {
    return undefined;
  }
  const pattern = extensionPattern(nativeFormats);
  const expression = `resourceExtname =~ /^\\.(${pattern})$/i`;
  const excludesDrawioImages =
    options.excludeDrawioImages === true || formats.some((format) => isDrawioImageFormat(format));
  return excludesDrawioImages ? `${expression} && !(${compoundDrawioMatch})` : expression;
}

function drawioImageMatch(formats: readonly SourceFormat[]): string | undefined {
  const matchingDrawioImageFormats = formats.filter((format) => isDrawioImageFormat(format));
  if (matchingDrawioImageFormats.length === 0) {
    return undefined;
  }
  const suffixes = [
    ...new Set(
      matchingDrawioImageFormats.flatMap((format) =>
        sourceFormatExtensions[format].map((extension) => extension.split('.').at(-1)),
      ),
    ),
  ];
  return String.raw`resourceFilename =~ /\.(drawio|dio)\.(${suffixes.join('|')})$/i`;
}

function sourceFormatMatch(formats: readonly SourceFormat[], options: { excludeDrawioImages?: boolean } = {}): string {
  const matches = [nativeExtensionMatch(formats, options), drawioImageMatch(formats)].filter(
    (match): match is string => match !== undefined,
  );
  if (matches.length === 0) {
    throw new Error('At least one source format is required for a menu match.');
  }
  return matches.length === 1 ? matches[0] : `(${matches.join(' || ')})`;
}

function pdfSplitOrSingleSource(formats: readonly SourceFormat[]): string {
  return `((${sourceFormatMatch(['pdf'])} && ${splitEnabled}) || (${sourceFormatMatch(formats)} && ${singleEnabled}))`;
}

function conversionWhen(sourceExpression: string): string {
  return `${contextMenuEnabled} && ${sourceExpression}`;
}

const allImageAndDrawioFormats = [
  ...nativeImageFormats,
  'drawio',
  ...drawioImageFormats,
] as const satisfies readonly SourceFormat[];
const conversionMenuWhenByCommand: Record<string, string> = {
  'graphics-workbench.convertToPdf': conversionWhen(
    `${sourceFormatMatch([...rasterFormats, 'svg', ...drawioImageFormats])} && ${singleEnabled}`,
  ),
  'graphics-workbench.convertToPng': conversionWhen(
    pdfSplitOrSingleSource(['jpeg', 'webp', 'avif', 'gif', 'tiff', 'svg', ...drawioImageFormats]),
  ),
  'graphics-workbench.convertToJpeg': conversionWhen(
    pdfSplitOrSingleSource(['png', 'webp', 'avif', 'gif', 'tiff', 'svg', ...drawioImageFormats]),
  ),
  'graphics-workbench.convertToWebp': conversionWhen(
    pdfSplitOrSingleSource(['png', 'jpeg', 'avif', 'gif', 'tiff', 'svg', ...drawioImageFormats]),
  ),
  'graphics-workbench.convertToWebpSplit': conversionWhen(`${sourceFormatMatch(['gif'])} && ${splitEnabled}`),
  'graphics-workbench.convertToAvif': conversionWhen(
    pdfSplitOrSingleSource(['png', 'jpeg', 'webp', 'gif', 'tiff', 'svg', ...drawioImageFormats]),
  ),
  'graphics-workbench.convertToSvg': conversionWhen(pdfSplitOrSingleSource(['drawio', ...drawioImageFormats])),
  'graphics-workbench.convertToGif': conversionWhen(
    pdfSplitOrSingleSource(['png', 'jpeg', 'webp', 'avif', 'tiff', 'svg', ...drawioImageFormats]),
  ),
  'graphics-workbench.convertToGifSplit': conversionWhen(`${sourceFormatMatch(['webp'])} && ${splitEnabled}`),
  'graphics-workbench.convertToTiff': conversionWhen(
    pdfSplitOrSingleSource(['png', 'jpeg', 'webp', 'avif', 'gif', 'svg', ...drawioImageFormats]),
  ),
  'graphics-workbench.convertToDrawio': conversionWhen(
    `${sourceFormatMatch(['pdf', ...nativeImageFormats, ...drawioImageFormats])} && ${singleEnabled}`,
  ),
  'graphics-workbench.convertToDrawioPng': conversionWhen(
    `${sourceFormatMatch(['pdf', ...nativeImageFormats, ...drawioImageFormats])} && ${singleEnabled}`,
  ),
  'graphics-workbench.convertToDrawioSvg': conversionWhen(
    `${sourceFormatMatch(['pdf', ...nativeImageFormats, ...drawioImageFormats])} && ${singleEnabled}`,
  ),
  'graphics-workbench.combineImagesToPdf': conversionWhen(
    `${sourceFormatMatch([...rasterFormats, 'svg'], { excludeDrawioImages: true })} && ${combineEnabled}`,
  ),
  'graphics-workbench.quickCombineImagesToPdf': conversionWhen(
    `${sourceFormatMatch([...rasterFormats, 'svg'], { excludeDrawioImages: true })} && ${combineEnabled}`,
  ),
};

const explorerContextWhenByCommand: Record<string, string> = {
  'graphics-workbench.rotateImage': `${sourceFormatMatch(rasterFormats)} && ${contextMenuEnabled} && config.graphics-workbench.contextMenu.rotateImage.enabled`,
  'graphics-workbench.convertDrawioToPagePdfs': `${sourceFormatMatch(['drawio', ...drawioImageFormats])} && ${contextMenuEnabled} && ${splitEnabled}`,
  'graphics-workbench.convertDrawioToSinglePdf': `${sourceFormatMatch(['drawio', ...drawioImageFormats])} && ${contextMenuEnabled} && ${singleEnabled}`,
  'graphics-workbench.compressImage': `${contextMenuEnabled} && config.graphics-workbench.contextMenu.compressImage.enabled && ${sourceFormatMatch(rasterFormats, { excludeDrawioImages: true })}`,
};

export function generatedMenuWhen(menuId: string, target: string): string | undefined {
  if (menuId === 'graphics-workbench.convert') {
    return conversionMenuWhenByCommand[target];
  }
  if (menuId === 'explorer/context') {
    return explorerContextWhenByCommand[target];
  }
  return undefined;
}

export function generatedSubmenuWhen(submenu: string): string | undefined {
  if (submenu !== 'graphics-workbench.convert') {
    return undefined;
  }
  return `${contextMenuEnabled} && ((${sourceFormatMatch(allImageAndDrawioFormats)} && (${singleEnabled} || ${combineEnabled})) || (${sourceFormatMatch(['pdf', 'gif', 'webp', 'drawio', ...drawioImageFormats])} && ${splitEnabled}))`;
}

export function assertFormatMatrixIsComplete(): void {
  const missing = extensionFormats.filter((format) => sourceFormatExtensions[format].length === 0);
  if (missing.length > 0) {
    throw new Error(`Source format menu matrix has no extensions for: ${missing.join(', ')}`);
  }
}
