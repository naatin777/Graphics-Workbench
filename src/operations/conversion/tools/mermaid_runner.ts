import { run as runMermaidCli } from '@mermaid-js/mermaid-cli';

type MermaidOutputFormat = 'svg' | 'png' | 'pdf';
type MermaidOutputFilePath = `${string}.svg` | `${string}.png` | `${string}.pdf`;

interface MermaidRunnerRequest {
  sourcePath: string;
  outputPath: MermaidOutputFilePath;
  outputFormat: MermaidOutputFormat;
  puppeteerConfig: Record<string, unknown>;
  backgroundColor?: string;
  theme?: string;
}

type MermaidCliParseOptions = NonNullable<Parameters<typeof runMermaidCli>[2]>;
type MermaidCliParseMmdOptions = NonNullable<MermaidCliParseOptions['parseMMDOptions']>;
type MermaidCliConfig = NonNullable<MermaidCliParseMmdOptions['mermaidConfig']>;

interface MermaidRunnerSuccess {
  ok: true;
}

interface MermaidRunnerFailure {
  ok: false;
  error: string;
}

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
  if (!isRunnerRequest(value)) {
    throw new Error('Invalid Mermaid runner request payload.');
  }

  return value;
}

function isRunnerRequest(value: unknown): value is MermaidRunnerRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    sourcePath?: unknown;
    outputPath?: unknown;
    outputFormat?: unknown;
    puppeteerConfig?: unknown;
    backgroundColor?: unknown;
    theme?: unknown;
  };

  return (
    typeof candidate.sourcePath === 'string' &&
    typeof candidate.outputPath === 'string' &&
    isOutputFilePath(candidate.outputPath) &&
    isMermaidOutputFormat(candidate.outputFormat) &&
    isPuppeteerConfig(candidate.puppeteerConfig) &&
    (candidate.backgroundColor === undefined || typeof candidate.backgroundColor === 'string') &&
    (candidate.theme === undefined || typeof candidate.theme === 'string')
  );
}

function isOutputFilePath(value: string): value is MermaidOutputFilePath {
  return value.endsWith('.svg') || value.endsWith('.png') || value.endsWith('.pdf');
}

function isMermaidOutputFormat(value: unknown): value is MermaidOutputFormat {
  return value === 'svg' || value === 'png' || value === 'pdf';
}

function isPuppeteerConfig(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
