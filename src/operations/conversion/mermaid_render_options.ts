import type { run as runMermaidCli } from '@mermaid-js/mermaid-cli';

import type { MermaidBackend } from './tools/index.js';

type MermaidCliRunOptions = NonNullable<Parameters<typeof runMermaidCli>[2]>;
type MermaidCliParseMmdOptions = NonNullable<MermaidCliRunOptions['parseMMDOptions']>;
type MermaidCliConfig = NonNullable<MermaidCliParseMmdOptions['mermaidConfig']>;

export function createMermaidPuppeteerConfig(
  options: MermaidBackend = { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
): Record<string, unknown> {
  const config: Record<string, unknown> = { headless: true };
  if (options.executablePath) {
    config.executablePath = options.executablePath;
  } else {
    config.channel = options.browserChannel;
  }
  return config;
}

export function createMermaidCliRenderOptions(
  options: Pick<MermaidBackend, 'theme' | 'backgroundColor'> = {
    theme: 'default',
    backgroundColor: 'white',
  },
): Pick<MermaidCliRunOptions, 'parseMMDOptions'> {
  return {
    parseMMDOptions: {
      backgroundColor: options.backgroundColor,
      mermaidConfig: {
        // Settings intentionally remain strings so invalid values are rejected by Mermaid CLI at render time.
        // Mermaid CLI accepts custom and invalid strings here and performs validation at render time.
        // Its declaration currently narrows this runtime setting to the built-in theme union.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- preserve Mermaid CLI's runtime validation contract
        theme: options.theme as NonNullable<MermaidCliConfig['theme']>,
      },
    },
  };
}
