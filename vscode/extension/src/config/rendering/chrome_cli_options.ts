import type { Configuration } from '../../generated/extension_manifest.js';

/**
 * Returns the configured Chrome executable path. A blank setting is reported
 * as-is: the caller decides how to present a missing path to the user.
 */
export function resolveChromeExecutablePath(configuration: Configuration): string {
  return configuration.execPath.chrome().trim();
}
