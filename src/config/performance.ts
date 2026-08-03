import type { Configuration } from '../generated-extension-meta.js';

export function getMaxConcurrentHeavyProcesses(configuration: Configuration): number {
  return configuration.performance.maxConcurrentHeavyProcesses();
}
