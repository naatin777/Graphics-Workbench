import type { Configuration } from '../../generated/extension_manifest.js';

/**
 * Resolves the Chrome executable path, falling back to the platform default
 * when the setting is blank. Production resolves tools from the explicit
 * setting first and falls back to the OS default command; tests inject the
 * path explicitly via GRAPHICS_WORKBENCH_TEST_* instead.
 */
export function resolveChromeExecutablePath(
  configuration: Configuration,
  platform: NodeJS.Platform = process.platform,
): string {
  const configuredPath = configuration.execPath.chrome().trim();
  if (configuredPath !== '') {
    return configuredPath;
  }

  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  if (platform === 'win32') {
    return 'chrome.exe';
  }

  return 'google-chrome';
}
