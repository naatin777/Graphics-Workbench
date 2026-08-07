import { configureExternalToolTimeouts } from '../../config/external_tools/external_tool_settings.js';
import { getExtensionConfiguration } from '../../config/extension_configuration.js';
import { readDrawioExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { getMaxConcurrentHeavyProcesses } from '../../config/performance.js';
import type { Configuration } from '../../generated/extension_manifest.js';
import {
  sharedConversionJobLimiter,
  sharedHeavyProcessLimiter,
} from '../../operations/external_tools/heavy_process_limiter.js';

import type { CommandDependencies } from './command_dependencies.js';

/** Applies external tool timeouts and process limiter concurrency from the given configuration. */
export function applyRuntimeConfiguration(configuration: Configuration): void {
  configureExternalToolTimeouts(configuration);

  const concurrency = getMaxConcurrentHeavyProcesses(configuration);
  sharedHeavyProcessLimiter.setConcurrency(concurrency);
  sharedConversionJobLimiter.setConcurrency(concurrency);
}

/** Reads the extension configuration and applies its runtime settings. */
export function configureCommandRuntime(dependencies?: CommandDependencies): Configuration {
  const configuration = dependencies?.getConfiguration?.() ?? getExtensionConfiguration();
  applyRuntimeConfiguration(configuration);
  return configuration;
}

/** Builds Draw.io command options from the configured executable path. */
export function buildDrawioCommandOptions(configuration: Configuration): { drawioPath: string } {
  return { drawioPath: readDrawioExecutablePath(configuration) };
}
