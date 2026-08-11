import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runExternalTool } from '../../external_tools/run_external_tool.js';

export type MermaidOutputFormat = 'svg' | 'png' | 'pdf';

export interface MermaidCliRunRequest {
  sourcePath: string;
  outputPath: string;
  outputFormat: MermaidOutputFormat;
  mermaidPath: string;
  chromePath: string;
  backgroundColor: string;
  theme: string;
}

/** Runs the external mmdc CLI (from @mermaid-js/mermaid-cli) as a child process. */
export async function runMermaidCliWithSignal(request: MermaidCliRunRequest, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (request.mermaidPath === '') {
    throw new Error('Mermaid CLI is not configured. Set graphics-workbench.execPath.mermaid.');
  }
  if (request.chromePath === '') {
    throw new Error('Chrome executable is not configured. Set graphics-workbench.execPath.chrome.');
  }

  await using configDirectory = await mkdtempDisposable(path.join(os.tmpdir(), 'graphics-workbench-mermaid-'));
  const mermaidConfigPath = path.join(configDirectory.path, 'mermaid-config.json');
  const chromeConfigPath = path.join(configDirectory.path, 'chrome-config.json');

  signal.throwIfAborted();
  await writeFile(mermaidConfigPath, JSON.stringify({ theme: request.theme }), 'utf8');
  signal.throwIfAborted();
  await writeFile(chromeConfigPath, JSON.stringify({ headless: true, executablePath: request.chromePath }), 'utf8');
  signal.throwIfAborted();

  await runExternalTool({
    toolId: 'mermaid',
    toolName: 'mermaid',
    executable: request.mermaidPath,
    args: createMermaidCliArgs(request, mermaidConfigPath, chromeConfigPath),
    signal,
  });
}

export function createMermaidCliArgs(
  request: MermaidCliRunRequest,
  mermaidConfigPath: string,
  chromeConfigPath: string,
): string[] {
  return [
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
