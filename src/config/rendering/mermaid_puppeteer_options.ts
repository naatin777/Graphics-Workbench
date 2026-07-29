import type { MermaidBackend } from '../../operations/conversion/tools/index.js';
import { configs, type ConfigurationReader } from '../../generated-extension-meta.js';

export type MermaidConfiguration = ConfigurationReader;

export function readPuppeteerExecutablePath(configuration: MermaidConfiguration): string {
  return configs.puppeteer.executablePath(configuration).trim();
}

export function readMermaidPuppeteerOptions(configuration: MermaidConfiguration): MermaidBackend {
  const executablePath = readPuppeteerExecutablePath(configuration);

  return {
    browserChannel: configs.puppeteer.browser(configuration),
    theme: configs.mermaid.theme(configuration),
    backgroundColor: configs.mermaid.backgroundColor(configuration),
    ...(executablePath ? { executablePath } : {}),
  };
}
