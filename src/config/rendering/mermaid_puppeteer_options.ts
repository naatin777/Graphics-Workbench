import type { MermaidBackend } from '../../operations/conversion/tools/index.js';

export type MermaidConfiguration = {
  get<T>(key: string, defaultValue: T): T;
};

export function readPuppeteerExecutablePath(configuration: MermaidConfiguration): string {
  return configuration.get<string>('puppeteer.executablePath', '').trim();
}

export function readMermaidPuppeteerOptions(configuration: MermaidConfiguration): MermaidBackend {
  const executablePath = readPuppeteerExecutablePath(configuration);

  return {
    browserChannel: configuration.get<string>('puppeteer.browser', 'chrome'),
    theme: configuration.get<string>('mermaid.theme', 'default'),
    backgroundColor: configuration.get<string>('mermaid.backgroundColor', 'white'),
    ...(executablePath ? { executablePath } : {}),
  };
}
