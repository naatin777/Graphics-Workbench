import type { Configuration } from '../../generated/extension_manifest.js';

/**
 * The explicit "use the OS default" value for graphics-workbench.execPath.chrome.
 * An unset setting resolves to this; a blank setting means "explicitly
 * disabled" and is reported as-is, matching the other execPath tools.
 */
export const chromeAutoValue = 'auto';

/** Returns the per-OS default Chrome executable path. */
export function defaultChromeExecutablePath(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  if (platform === 'win32') {
    return 'chrome.exe';
  }

  return 'google-chrome';
}

/**
 * Resolves the Chrome executable path. `auto` (the default) selects the OS
 * default path; a blank setting is an explicit disable and is returned as-is
 * so the caller can report it as notConfigured.
 */
export function resolveChromeExecutablePath(
  configuration: Configuration,
  platform: NodeJS.Platform = process.platform,
): string {
  const configuredPath = configuration.execPath.chrome().trim();
  if (configuredPath === chromeAutoValue) {
    return defaultChromeExecutablePath(platform);
  }
  return configuredPath;
}
