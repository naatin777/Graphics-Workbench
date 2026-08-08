import { getDefaultConfiguration, type Configuration } from '../generated/extension_manifest.js';

const MAX_CONFIGURED_INPUT_PIXELS = 1_000_000_000;

// Matches Sharp's default input pixel limit: 0x3fff × 0x3fff.
export function getMaxInputPixels(configuration: Configuration): number {
  const configuredValue = configuration.raster.maxInputPixels();

  if (
    typeof configuredValue === 'number' &&
    Number.isSafeInteger(configuredValue) &&
    configuredValue >= 1 &&
    configuredValue <= MAX_CONFIGURED_INPUT_PIXELS
  ) {
    return configuredValue;
  }

  return getDefaultConfiguration().raster.maxInputPixels();
}

export function getMaxAnimationPixels(configuration: Configuration): number {
  return configuration.raster.maxAnimationPixels();
}

export function assertAnimationPixelLimit(
  width: number,
  pageHeight: number,
  frameCount: number,
  maxAnimationPixels: number,
  sourcePath: string,
): void {
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(pageHeight) ||
    pageHeight < 1 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount < 1
  ) {
    throw new Error(`Could not determine safe animation dimensions: ${sourcePath}`);
  }

  const totalPixels = BigInt(width) * BigInt(pageHeight) * BigInt(frameCount);
  if (totalPixels > BigInt(maxAnimationPixels)) {
    throw new Error(
      [
        'The animated raster input exceeds the configured total animation pixel limit.',
        '',
        `Configured limit: ${maxAnimationPixels.toLocaleString('en-US')} pixels`,
        `Animation pixels: ${totalPixels.toString()} pixels`,
        `Input: ${sourcePath}`,
      ].join('\n'),
    );
  }
}
