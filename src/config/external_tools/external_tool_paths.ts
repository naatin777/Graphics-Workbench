import { configs, type ConfigurationReader } from '../../generated-extension-meta.js';

export function readDrawioExecutablePath(configuration: ConfigurationReader): string {
  return configs.execPath.drawio(configuration);
}

export function readGhostscriptExecutablePath(configuration: ConfigurationReader): string {
  return configs.execPath.ghostscript(configuration);
}

export function readPdftocairoExecutablePath(configuration: ConfigurationReader): string {
  return configs.execPath.pdftocairo(configuration);
}

export function readRsvgConvertExecutablePath(configuration: ConfigurationReader): string {
  return configs.execPath.rsvgConvert(configuration);
}
