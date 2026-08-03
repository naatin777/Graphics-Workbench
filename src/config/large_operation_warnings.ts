import type { Configuration } from '../generated-extension-meta.js';

export interface LargeOperationWarningSettings {
  enabled: boolean;
  pdfPages: number;
  inputSizeMiB: number;
}

export interface LargeOperationWarningMetrics {
  totalBytes: number;
  pdfPageCount?: number;
}

export interface LargeOperationWarningReasons {
  pdfPageCount?: number;
  inputSizeMiB?: number;
}

let configuredSettings: LargeOperationWarningSettings = {
  enabled: true,
  pdfPages: 1000,
  inputSizeMiB: 500,
};

function readLargeOperationWarningSettings(configuration: Configuration): LargeOperationWarningSettings {
  return {
    enabled: configuration.largeOperationWarnings.enabled(),
    pdfPages: configuration.largeOperationWarnings.pdfPages(),
    inputSizeMiB: configuration.largeOperationWarnings.inputSizeMiB(),
  };
}

export function configureLargeOperationWarningSettings(configuration: Configuration): void {
  configuredSettings = readLargeOperationWarningSettings(configuration);
}

export function getLargeOperationWarningSettings(): LargeOperationWarningSettings {
  return configuredSettings;
}

export function getLargeOperationWarningReasons(
  settings: LargeOperationWarningSettings,
  metrics: LargeOperationWarningMetrics,
): LargeOperationWarningReasons {
  if (!settings.enabled) {
    return {};
  }
  const totalSizeMiB = metrics.totalBytes / (1024 * 1024);
  const reasons: LargeOperationWarningReasons = {};
  if (settings.pdfPages > 0 && (metrics.pdfPageCount ?? 0) >= settings.pdfPages) {
    reasons.pdfPageCount = metrics.pdfPageCount ?? 0;
  }
  if (settings.inputSizeMiB > 0 && totalSizeMiB >= settings.inputSizeMiB) {
    reasons.inputSizeMiB = Math.ceil(totalSizeMiB);
  }
  return reasons;
}
