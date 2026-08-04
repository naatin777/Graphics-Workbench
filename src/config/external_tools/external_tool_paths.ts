import type { Configuration } from '../../generated/extension_manifest.js';

export function readDrawioExecutablePath(configuration: Configuration): string {
  return configuration.execPath.drawio();
}

export function readGhostscriptExecutablePath(configuration: Configuration): string {
  return resolveGhostscriptExecutablePath(configuration.execPath.ghostscript());
}

export function resolveGhostscriptExecutablePath(
  configuredPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configuredPath !== '') {
    return configuredPath;
  }

  return platform === 'win32' ? 'gswin64c' : 'gs';
}

export function readPdftocairoExecutablePath(configuration: Configuration): string {
  return configuration.execPath.pdftocairo();
}

export function readRsvgConvertExecutablePath(configuration: Configuration): string {
  return configuration.execPath.rsvgConvert();
}
