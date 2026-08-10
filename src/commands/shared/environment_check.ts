import { resolveChromeExecutablePath } from '../../config/rendering/mermaid_cli_options.js';
import type { Configuration } from '../../generated/extension_manifest.js';
import { runExternalTool } from '../../operations/external_tools/run_external_tool.js';

import { userMessage } from './user_messages.js';

const CHECK_TIMEOUT_MS = 10_000;

interface ToolAvailability {
  available: boolean;
  detail: string;
  settingId: string;
}

interface ToolProbeParams {
  toolName: string;
  executable: string;
  versionArgs: string[];
  signal: AbortSignal | undefined;
  timeoutMs?: number;
}

type ProbeTool = (probe: ToolProbeParams) => Promise<void>;

const defaultProbe: ProbeTool = async (probe) => {
  const { toolName, executable, versionArgs, signal, timeoutMs } = probe;
  const options: Parameters<typeof runExternalTool>[0] = {
    toolName,
    executable,
    args: versionArgs,
  };
  if (signal !== undefined) {
    options.signal = signal;
  }
  if (timeoutMs !== undefined) {
    options.timeoutMs = timeoutMs;
  }
  await runExternalTool(options);
};

export const environmentProbe: ProbeTool = defaultProbe;

export interface RunFeatureAvailabilityChecksOptions {
  configuration: Configuration;
  signal?: AbortSignal;
  timeoutMs?: number;
  probe: ProbeTool;
}

export type FeatureAvailabilityId = 'pdf-operations' | 'images' | 'svg-to-pdf' | 'drawio' | 'mermaid';

export interface FeatureAvailabilityEntry {
  id: FeatureAvailabilityId;
  available: boolean;
  detail: string;
  settingId?: string;
}

/** Returns the current feature availability shown in Controls. */
export async function runFeatureAvailabilityChecks(
  options: RunFeatureAvailabilityChecksOptions,
): Promise<FeatureAvailabilityEntry[]> {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const probe = options.probe;
  const check = async (
    params: Omit<Parameters<typeof checkTool>[0], 'timeoutMs' | 'signal' | 'probe'>,
  ): Promise<ToolAvailability> => checkTool({ ...params, timeoutMs, signal: options.signal, probe });

  const chromePromise = check({
    toolLabel: userMessage('message.environmentCheck.tool.browser'),
    executable: resolveChromeExecutablePath(options.configuration),
    versionArgs: ['--version'],
    settingId: 'graphics-workbench.execPath.chrome',
  });
  const svgToPdfPromise =
    options.configuration.convertToPdf.svg.engine() === 'chrome'
      ? chromePromise
      : check({
          toolLabel: userMessage('message.environmentCheck.tool.rsvgConvert'),
          executable: options.configuration.execPath.rsvgConvert(),
          versionArgs: ['--version'],
          settingId: 'graphics-workbench.execPath.rsvgConvert',
        });
  const drawioPromise = check({
    toolLabel: userMessage('message.environmentCheck.tool.drawio'),
    executable: options.configuration.execPath.drawio(),
    versionArgs: ['--version'],
    settingId: 'graphics-workbench.execPath.drawio',
  });
  const mermaidCliPromise = check({
    toolLabel: userMessage('message.environmentCheck.tool.mermaidCli'),
    executable: options.configuration.execPath.mermaid(),
    versionArgs: ['--version'],
    settingId: 'graphics-workbench.execPath.mermaid',
  });
  const [drawio, mermaidCli, chrome, svgToPdf] = await Promise.all([
    drawioPromise,
    mermaidCliPromise,
    chromePromise,
    svgToPdfPromise,
  ]);
  const mermaid = mermaidCli.available ? chrome : mermaidCli;
  const builtinDetail = userMessage('message.environmentCheck.available');

  return [
    { id: 'pdf-operations', available: true, detail: builtinDetail },
    { id: 'images', available: true, detail: builtinDetail },
    { id: 'svg-to-pdf', ...svgToPdf },
    { id: 'drawio', ...drawio },
    { id: 'mermaid', ...mermaid },
  ];
}

async function checkTool(params: {
  toolLabel: string;
  executable: string;
  versionArgs: string[];
  settingId: string;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  probe: ProbeTool;
}): Promise<ToolAvailability> {
  const { toolLabel, executable, versionArgs, settingId, timeoutMs, signal, probe } = params;

  try {
    await probe({ toolName: toolLabel, executable, versionArgs, signal, timeoutMs });
    return { available: true, detail: userMessage('message.environmentCheck.available'), settingId };
  } catch (error) {
    if (signal?.aborted === true) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (isExecutableNotFound(error)) {
      return { available: false, detail: userMessage('message.environmentCheck.notFound', toolLabel), settingId };
    }
    if (isTimeout(error)) {
      return { available: false, detail: userMessage('message.environmentCheck.timedOut', toolLabel), settingId };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { available: false, detail: userMessage('message.environmentCheck.failed', toolLabel, reason), settingId };
  }
}

// oxlint-disable-next-line typescript/no-restricted-types -- 型ガード: catch由来の値を識別する。
function isExecutableNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && Reflect.get(error, 'code') === 'ENOENT';
}

// oxlint-disable-next-line typescript/no-restricted-types -- 型ガード: catch由来の値を識別する。
function isTimeout(error: unknown): boolean {
  return error instanceof Error && /timed out|did not terminate/u.test(error.message);
}
