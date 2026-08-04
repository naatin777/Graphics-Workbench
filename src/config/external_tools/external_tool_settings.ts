import type { Configuration } from '../../generated/extension_manifest.js';

export type ExternalToolId = 'qpdf' | 'drawio' | 'ghostscript' | 'pdftocairo' | 'rsvg-convert' | 'mermaid';

export type ExternalToolTimeouts = Readonly<Record<ExternalToolId, number | undefined>>;

const defaultTimeouts: ExternalToolTimeouts = {
  qpdf: undefined,
  drawio: undefined,
  ghostscript: undefined,
  pdftocairo: undefined,
  'rsvg-convert': undefined,
  mermaid: undefined,
};

let configuredTimeouts: ExternalToolTimeouts = defaultTimeouts;

export function readExternalToolTimeouts(configuration: Configuration): ExternalToolTimeouts {
  return {
    qpdf: timeoutMilliseconds(configuration.externalTools.qpdf.timeoutSeconds()),
    drawio: timeoutMilliseconds(configuration.externalTools.drawio.timeoutSeconds()),
    ghostscript: timeoutMilliseconds(configuration.externalTools.ghostscript.timeoutSeconds()),
    pdftocairo: timeoutMilliseconds(configuration.externalTools.pdftocairo.timeoutSeconds()),
    'rsvg-convert': timeoutMilliseconds(configuration.externalTools.rsvgConvert.timeoutSeconds()),
    mermaid: timeoutMilliseconds(configuration.externalTools.mermaid.timeoutSeconds()),
  };
}

export function configureExternalToolTimeouts(configuration: Configuration): void {
  configuredTimeouts = readExternalToolTimeouts(configuration);
}

export function getExternalToolTimeoutMs(toolId: ExternalToolId): number | undefined {
  return configuredTimeouts[toolId];
}

export function timeoutMilliseconds(seconds: number): number | undefined {
  return seconds === 0 ? undefined : seconds * 1000;
}

export function defaultExternalToolTimeouts(): ExternalToolTimeouts {
  return defaultTimeouts;
}
