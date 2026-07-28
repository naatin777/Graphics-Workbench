import type { MermaidBackend } from '../../operations/conversion/tools/index.js';

export type MermaidConfiguration = {
  get(key: string, defaultValue: string): string;
};

export function readPuppeteerExecutablePath(configuration: MermaidConfiguration): string {
  return configuration.get('puppeteer.executablePath', '').trim();
}

export function readMermaidPuppeteerOptions(configuration: MermaidConfiguration): MermaidBackend {
  const executablePath = readPuppeteerExecutablePath(configuration);

  return {
    browserChannel: configuration.get('puppeteer.browser', 'chrome'),
    theme: configuration.get('mermaid.theme', 'default'),
    backgroundColor: configuration.get('mermaid.backgroundColor', 'white'),
    ...(executablePath ? { executablePath } : {}),
  };
}
