import type { Configuration } from '../../generated/extension_manifest.js';

export function readDrawioExecutablePath(configuration: Configuration): string {
  return configuration.execPath.drawio();
}

export function readMermaidExecutablePath(configuration: Configuration): string {
  return configuration.execPath.mermaid();
}

export function readRsvgConvertExecutablePath(configuration: Configuration): string {
  return configuration.execPath.rsvgConvert();
}
