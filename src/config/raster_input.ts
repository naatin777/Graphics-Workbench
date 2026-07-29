import { configs, type ConfigurationReader } from '../generated-extension-meta.js';

// Matches Sharp's default input pixel limit: 0x3fff × 0x3fff.
export function getMaxInputPixels(configuration: ConfigurationReader): number {
  const configuredValue = configs.raster.maxInputPixels(configuration);

  if (typeof configuredValue === 'number' && Number.isSafeInteger(configuredValue) && configuredValue >= 1) {
    return configuredValue;
  }

  return configs.raster.maxInputPixels();
}
