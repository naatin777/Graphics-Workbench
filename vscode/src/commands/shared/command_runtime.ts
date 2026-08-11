import { configureExternalToolTimeouts } from '@graphics-workbench/core/config/external_tools/external_tool_settings.js';
import { applyUndoHistoryConfiguration } from '../lifecycle/undo_last_conversion.js';
import type { Configuration } from '../../generated/extension_manifest.js';
import {
  sharedConversionJobLimiter,
  sharedHeavyProcessLimiter,
} from '@graphics-workbench/core/operations/external_tools/heavy_process_limiter.js';

/** Applies external tool timeouts, process limiter concurrency, and Undo history limits from the given configuration. */
export function applyRuntimeConfiguration(configuration: Configuration): void {
  configureExternalToolTimeouts(configuration);

  const concurrency = configuration.performance.maxConcurrentHeavyProcesses();
  sharedHeavyProcessLimiter.setConcurrency(concurrency);
  sharedConversionJobLimiter.setConcurrency(concurrency);

  applyUndoHistoryConfiguration(configuration);
}
