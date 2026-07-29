import type { run as runMermaidCli } from '@mermaid-js/mermaid-cli';

import type { MermaidBackend } from './tools/index.js';

type MermaidCliRunOptions = NonNullable<Parameters<typeof runMermaidCli>[2]>;
type MermaidCliParseMmdOptions = NonNullable<MermaidCliRunOptions['parseMMDOptions']>;
type MermaidCliConfig = NonNullable<MermaidCliParseMmdOptions['mermaidConfig']>;

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

export function createMermaidCliRenderOptions(
  options?: Pick<MermaidBackend, 'theme' | 'backgroundColor'>,
): Pick<MermaidCliRunOptions, 'parseMMDOptions'> {
  const resolvedOptions = options ?? { theme: 'default', backgroundColor: 'white' };
  return {
    parseMMDOptions: {
      backgroundColor: resolvedOptions.backgroundColor,
      mermaidConfig: {
        // Settings intentionally remain strings so invalid values are rejected by Mermaid CLI at render time.
        // Mermaid CLI accepts custom and invalid strings here and performs validation at render time.
        // Its declaration currently narrows this runtime setting to the built-in theme union.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- preserve Mermaid CLI's runtime validation contract
        theme: resolvedOptions.theme as NonNullable<MermaidCliConfig['theme']>,
      },
    },
  };
}
