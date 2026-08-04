import type { Configuration } from '../generated/extension_manifest.js';

export function getMaxConcurrentHeavyProcesses(configuration: Configuration): number {
  return configuration.performance.maxConcurrentHeavyProcesses();
}
