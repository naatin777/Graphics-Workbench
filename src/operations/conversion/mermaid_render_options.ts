import type { MermaidBackend } from './tools/index.js';

export function createMermaidPuppeteerConfig(options?: MermaidBackend): Record<string, unknown> {
  const resolvedOptions = options ?? { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' };
  const config: Record<string, unknown> = { headless: true };
  if (resolvedOptions.executablePath !== undefined && resolvedOptions.executablePath !== '') {
    config.executablePath = resolvedOptions.executablePath;
  } else {
    config.channel = resolvedOptions.browserChannel;
  }
  return config;
}
