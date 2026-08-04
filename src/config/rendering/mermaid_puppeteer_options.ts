import type { MermaidBackend } from '../../operations/conversion/tools/index.js';
import type { Configuration } from '../../generated/extension_manifest.js';

export type MermaidConfiguration = Configuration;

export function readPuppeteerExecutablePath(configuration: MermaidConfiguration): string {
  return configuration.puppeteer.executablePath().trim();
}

export function readMermaidPuppeteerOptions(configuration: MermaidConfiguration): MermaidBackend {
  const executablePath = readPuppeteerExecutablePath(configuration);

  return {
    browserChannel: configuration.puppeteer.browser(),
    theme: configuration.mermaid.theme(),
    backgroundColor: configuration.mermaid.backgroundColor(),
    ...(executablePath ? { executablePath } : {}),
  };
}
