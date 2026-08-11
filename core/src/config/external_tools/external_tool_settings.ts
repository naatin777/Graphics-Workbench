export type ExternalToolId = 'drawio' | 'rsvgConvert';

export interface ExternalToolTimeoutConfiguration {
  externalTools: Readonly<Record<ExternalToolId, { timeoutSeconds: () => number }>>;
}

export type ExternalToolTimeouts = Readonly<Record<ExternalToolId, number | undefined>>;

const defaultTimeouts: ExternalToolTimeouts = {
  drawio: undefined,
  rsvgConvert: undefined,
};

let configuredTimeouts: ExternalToolTimeouts = defaultTimeouts;

export function readExternalToolTimeouts(configuration: ExternalToolTimeoutConfiguration): ExternalToolTimeouts {
  return {
    drawio: timeoutMilliseconds(configuration.externalTools.drawio.timeoutSeconds()),
    rsvgConvert: timeoutMilliseconds(configuration.externalTools.rsvgConvert.timeoutSeconds()),
  };
}

export function configureExternalToolTimeouts(configuration: ExternalToolTimeoutConfiguration): void {
  configuredTimeouts = readExternalToolTimeouts(configuration);
}

export function getExternalToolTimeoutMs(toolId: ExternalToolId): number | undefined {
  return configuredTimeouts[toolId];
}

export function timeoutMilliseconds(seconds: number): number | undefined {
  return seconds === 0 ? undefined : seconds * 1000;
}
