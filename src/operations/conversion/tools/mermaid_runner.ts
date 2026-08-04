import { run as runMermaidCli } from '@mermaid-js/mermaid-cli';

import {
  type MermaidRunnerFailure,
  type MermaidRunnerRequest,
  type MermaidRunnerSuccess,
  parseMermaidRunnerRequest,
} from './mermaid_runner_protocol.js';

type MermaidCliParseOptions = NonNullable<Parameters<typeof runMermaidCli>[2]>;
type MermaidCliParseMmdOptions = NonNullable<MermaidCliParseOptions['parseMMDOptions']>;
type MermaidCliConfig = NonNullable<MermaidCliParseMmdOptions['mermaidConfig']>;

process.on('message', (message: unknown) => {
  void runRequest(message);
});

async function runRequest(message: unknown): Promise<void> {
  try {
    const request = parseRunnerRequest(message);
    await runMermaidCli(request.sourcePath, request.outputPath, {
      outputFormat: request.outputFormat,
      puppeteerConfig: request.puppeteerConfig,
      quiet: true,
      ...createRenderOptions(request),
    });
    process.send?.({ ok: true } satisfies MermaidRunnerSuccess);
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    process.send?.({ ok: false, error: failureMessage } satisfies MermaidRunnerFailure);
  }
}

function createRenderOptions(request: MermaidRunnerRequest): Pick<MermaidCliParseOptions, 'parseMMDOptions'> {
  const backgroundColor = request.backgroundColor === undefined ? {} : { backgroundColor: request.backgroundColor };
  const mermaidConfig =
    request.theme === undefined
      ? {}
      : {
          mermaidConfig: {
            // Settings intentionally remain strings so invalid values are rejected by Mermaid CLI at render time.
            // Mermaid CLI accepts custom and invalid strings here and performs validation at render time.
            // Its declaration currently narrows this runtime setting to the built-in theme union.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- preserve Mermaid CLI's runtime validation contract
            theme: request.theme as NonNullable<MermaidCliConfig['theme']>,
          },
        };

  return { parseMMDOptions: { ...backgroundColor, ...mermaidConfig } };
}

function parseRunnerRequest(value: unknown): MermaidRunnerRequest {
  return parseMermaidRunnerRequest(value);
}
