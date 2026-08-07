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
