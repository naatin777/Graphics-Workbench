import type { Configuration } from '../../generated/extension_manifest.js';

export function readDrawioExecutablePath(configuration: Configuration): string {
  return configuration.execPath.drawio();
}

export function readPdftocairoExecutablePath(configuration: Configuration): string {
  return configuration.execPath.pdftocairo();
}

export function readRsvgConvertExecutablePath(configuration: Configuration): string {
  return configuration.execPath.rsvgConvert();
}
