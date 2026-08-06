import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { runExternalTool } from '../../external_tools/run_external_tool.js';

const requireFromModule = createRequire(import.meta.url);

export type MermaidOutputFormat = 'svg' | 'png' | 'pdf';

export interface MermaidCliRunRequest {
  sourcePath: string;
  outputPath: string;
  outputFormat: MermaidOutputFormat;
  chromePath: string;
  backgroundColor: string;
  theme: string;
}

/** Runs the bundled mmdc CLI as a normal child process. */
export async function runMermaidCliWithSignal(request: MermaidCliRunRequest, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (request.chromePath === '') {
    throw new Error('Chrome executable is not configured. Set graphics-workbench.execPath.chrome.');
  }

  const configDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-'));
  const mermaidConfigPath = path.join(configDirectory, 'mermaid-config.json');
  const chromeConfigPath = path.join(configDirectory, 'chrome-config.json');

  try {
    signal?.throwIfAborted();
    await writeFile(mermaidConfigPath, JSON.stringify({ theme: request.theme }), 'utf8');
    signal?.throwIfAborted();
    await writeFile(chromeConfigPath, JSON.stringify({ headless: true, executablePath: request.chromePath }), 'utf8');
    signal?.throwIfAborted();

    await runExternalTool({
      toolName: 'mermaid',
      executable: process.execPath,
      args: createMermaidCliArgs(request, mermaidConfigPath, chromeConfigPath),
      env: mermaidCliEnvironment(),
      ...(signal === undefined ? {} : { signal }),
    });
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
}

export function createMermaidCliArgs(
  request: MermaidCliRunRequest,
  mermaidConfigPath: string,
  chromeConfigPath: string,
): string[] {
  return [
    mmdcEntrypointPath(),
    '--input',
    request.sourcePath,
    '--output',
    request.outputPath,
    '--outputFormat',
    request.outputFormat,
    '--backgroundColor',
    request.backgroundColor,
    '--configFile',
    mermaidConfigPath,
    '--puppeteerConfigFile',
    chromeConfigPath,
    '--quiet',
  ];
}

function mmdcEntrypointPath(): string {
  return path.join(path.dirname(requireFromModule.resolve('@mermaid-js/mermaid-cli')), 'cli.js');
}

function mermaidCliEnvironment(): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VSCODE_')));
  return { ...environment, ELECTRON_RUN_AS_NODE: '1' };
}
