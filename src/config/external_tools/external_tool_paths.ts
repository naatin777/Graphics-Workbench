import type { Configuration } from '../../generated-extension-meta.js';

export function readDrawioExecutablePath(configuration: Configuration): string {
  return configuration.execPath.drawio();
}

export function readGhostscriptExecutablePath(configuration: Configuration): string {
  return configuration.execPath.ghostscript();
}

export function readPdftocairoExecutablePath(configuration: Configuration): string {
  return configuration.execPath.pdftocairo();
}

export function readRsvgConvertExecutablePath(configuration: Configuration): string {
  return configuration.execPath.rsvgConvert();
}

export function readQpdfExecutablePath(configuration: Configuration): string {
  return configuration.execPath.qpdf();
}
