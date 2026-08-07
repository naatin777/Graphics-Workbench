import type { Configuration } from '../../generated/extension_manifest.js';
import type { MermaidBackend } from '../../operations/conversion/tools/index.js';
import { readMermaidExecutablePath } from '../external_tools/external_tool_paths.js';

export type MermaidConfiguration = Configuration;

export function readChromeExecutablePath(configuration: MermaidConfiguration): string {
  return resolveChromeExecutablePath(configuration.execPath.chrome().trim());
}

export function resolveChromeExecutablePath(
  configuredPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
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

export function readMermaidCliOptions(configuration: MermaidConfiguration): MermaidBackend {
  return {
    chromePath: readChromeExecutablePath(configuration),
    mermaidPath: readMermaidExecutablePath(configuration),
    theme: configuration.mermaid.theme(),
    backgroundColor: configuration.mermaid.backgroundColor(),
  };
}
