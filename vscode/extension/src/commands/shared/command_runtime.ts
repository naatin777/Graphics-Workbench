import { configureExternalToolTimeouts, setHeavyProcessConcurrency } from '@graphics-workbench/core/external-tools';
import { applyUndoHistoryConfiguration } from '../lifecycle/undo_last_conversion.js';
import type { Configuration } from '../../generated/extension_manifest.js';

/** Applies external tool timeouts, process limiter concurrency, and Undo history limits from the given configuration. */
export function applyRuntimeConfiguration(configuration: Configuration): void {
  configureExternalToolTimeouts(configuration);

  const concurrency = configuration.performance.maxConcurrentHeavyProcesses();
  setHeavyProcessConcurrency(concurrency);

  applyUndoHistoryConfiguration(configuration);
}
