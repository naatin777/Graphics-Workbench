import type { externalToolTimeoutConfigurationKeys, Configuration } from '../../generated/extension_manifest.js';

export type ExternalToolId = keyof typeof externalToolTimeoutConfigurationKeys;

export type ExternalToolTimeouts = Readonly<Record<ExternalToolId, number | undefined>>;

const defaultTimeouts: ExternalToolTimeouts = {
  drawio: undefined,
  rsvgConvert: undefined,
  mermaid: undefined,
};

let configuredTimeouts: ExternalToolTimeouts = defaultTimeouts;

export function readExternalToolTimeouts(configuration: Configuration): ExternalToolTimeouts {
  return {
    drawio: timeoutMilliseconds(configuration.externalTools.drawio.timeoutSeconds()),
    rsvgConvert: timeoutMilliseconds(configuration.externalTools.rsvgConvert.timeoutSeconds()),
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
