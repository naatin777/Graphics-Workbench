import type { Configuration } from '../../generated-extension-meta.js';

export type ExternalToolId = 'qpdf' | 'drawio' | 'ghostscript' | 'pdftocairo' | 'rsvg-convert' | 'mermaid';

export type ExternalToolTimeouts = Readonly<Record<ExternalToolId, number | undefined>>;

const defaultTimeouts: ExternalToolTimeouts = {
  qpdf: 120_000,
  drawio: 300_000,
  ghostscript: 300_000,
  pdftocairo: 120_000,
  'rsvg-convert': 120_000,
  mermaid: 120_000,
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
