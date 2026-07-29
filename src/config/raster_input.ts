import { getDefaultConfiguration, type Configuration } from '../generated-extension-meta.js';

// Matches Sharp's default input pixel limit: 0x3fff × 0x3fff.
export function getMaxInputPixels(configuration: Configuration): number {
  const configuredValue = configuration.raster.maxInputPixels();

  if (typeof configuredValue === 'number' && Number.isSafeInteger(configuredValue) && configuredValue >= 1) {
    return configuredValue;
  }

  return getDefaultConfiguration().raster.maxInputPixels();
}
