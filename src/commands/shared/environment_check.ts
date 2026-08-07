import * as vscode from 'vscode';

import {
  readDrawioExecutablePath,
  readMermaidExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../config/external_tools/external_tool_paths.js';
import { readChromeExecutablePath } from '../../config/rendering/mermaid_cli_options.js';
import type { Configuration } from '../../generated/extension_manifest.js';
import { runExternalTool } from '../../operations/external_tools/run_external_tool.js';

import type { CommandDependencies } from './command_dependencies.js';
import { configureCommandRuntime } from './command_runtime.js';
import { userMessage } from './user_messages.js';

const CHECK_TIMEOUT_MS = 10_000;

export interface EnvironmentCheckEntry {
  /** 機能単位の表示ラベル。 */
  feature: string;
  /** 利用可能かどうか。 */
  status: 'available' | 'unavailable';
  /** 状況の詳細（例: "Ghostscript not found"）。 */
  detail: string;
  /** 関連設定のID。未定義なら設定ページを開けない。 */
  settingId?: string;
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

export interface RunEnvironmentChecksOptions {
  configuration: Configuration;
  signal?: AbortSignal;
  timeoutMs?: number;
  probe?: ProbeTool;
}

/** 各外部ツールを `--version` で確認し、機能単位の状態一覧を返す。 */
export async function runEnvironmentChecks(options: RunEnvironmentChecksOptions): Promise<EnvironmentCheckEntry[]> {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const probe = options.probe ?? defaultProbe;

  const entries: EnvironmentCheckEntry[] = [
    {
      feature: userMessage('message.environmentCheck.feature.imageConversion'),
      status: 'available',
      detail: userMessage('message.environmentCheck.available'),
    },
    {
      feature: userMessage('message.environmentCheck.feature.pdfMergeSplitReorder'),
      status: 'available',
      detail: userMessage('message.environmentCheck.available'),
    },
  ];

  entries.push(
    await checkTool({
      feature: userMessage('message.environmentCheck.feature.drawioConversion'),
      toolLabel: userMessage('message.environmentCheck.tool.drawio'),
      executable: readDrawioExecutablePath(options.configuration),
      versionArgs: ['--version'],
      settingId: 'graphics-workbench.execPath.drawio',
      timeoutMs,
      signal: options.signal,
      probe,
    }),
  );

  entries.push(await checkChrome(options.configuration, timeoutMs, options.signal, probe));

  entries.push(
    await checkTool({
      feature: userMessage('message.environmentCheck.feature.mermaidCli'),
      toolLabel: userMessage('message.environmentCheck.tool.mermaidCli'),
      executable: readMermaidExecutablePath(options.configuration),
      versionArgs: ['--version'],
      settingId: 'graphics-workbench.execPath.mermaid',
      timeoutMs,
      signal: options.signal,
      probe,
    }),
  );

  const svgEngine = options.configuration.convertToPdf.svg.engine();
  if (svgEngine === 'rsvg-convert') {
    entries.push(
      await checkTool({
        feature: userMessage('message.environmentCheck.feature.svgToPdf'),
        toolLabel: userMessage('message.environmentCheck.tool.rsvgConvert'),
        executable: readRsvgConvertExecutablePath(options.configuration),
        versionArgs: ['--version'],
        settingId: 'graphics-workbench.execPath.rsvgConvert',
        timeoutMs,
        signal: options.signal,
        probe,
      }),
    );
  }

  return entries;
}

async function checkTool(params: {
  feature: string;
  toolLabel: string;
  executable: string;
  versionArgs: string[];
  settingId: string;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  probe: ProbeTool;
}): Promise<EnvironmentCheckEntry> {
  const { feature, toolLabel, executable, versionArgs, settingId, timeoutMs, signal, probe } = params;

  try {
    await probe({ toolName: toolLabel, executable, versionArgs, signal, timeoutMs });
    return { feature, status: 'available', detail: userMessage('message.environmentCheck.available'), settingId };
  } catch (error) {
    if (signal?.aborted === true) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (isExecutableNotFound(error)) {
      return {
        feature,
        status: 'unavailable',
        detail: userMessage('message.environmentCheck.notFound', toolLabel),
        settingId,
      };
    }
    if (isTimeout(error)) {
      return {
        feature,
        status: 'unavailable',
        detail: userMessage('message.environmentCheck.timedOut', toolLabel),
        settingId,
      };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return {
      feature,
      status: 'unavailable',
      detail: userMessage('message.environmentCheck.failed', toolLabel, reason),
      settingId,
    };
  }
}

async function checkChrome(
  configuration: Configuration,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  probe: ProbeTool,
): Promise<EnvironmentCheckEntry> {
  const feature = userMessage('message.environmentCheck.feature.mermaidConversion');
  const chromePath = readChromeExecutablePath(configuration);

  return checkTool({
    feature,
    toolLabel: userMessage('message.environmentCheck.tool.browser'),
    executable: chromePath,
    versionArgs: ['--version'],
    settingId: 'graphics-workbench.execPath.chrome',
    timeoutMs,
    signal,
    probe,
  });
}

function isExecutableNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && Reflect.get(error, 'code') === 'ENOENT';
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && /timed out|did not terminate/u.test(error.message);
}

export async function checkEnvironmentCommand(_uri: undefined, dependencies?: CommandDependencies): Promise<void> {
  const configuration = configureCommandRuntime(dependencies);
  const outputChannel = dependencies?.outputChannel;

  outputChannel?.appendLine(`[environment-check] starting`);

  let entries: EnvironmentCheckEntry[];
  try {
    entries = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: userMessage('message.environmentCheck.title'),
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: userMessage('message.environmentCheck.progress') });
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        return runEnvironmentChecks({ configuration, signal: controller.signal });
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[environment-check] failure: ${message}`);
    await vscode.window.showErrorMessage(userMessage('message.environmentCheck.failed', 'environment', message));
    return;
  }

  outputChannel?.appendLine(`[environment-check] completed`);
  const available = entries.filter((entry) => entry.status === 'available').length;
  const unavailable = entries.length - available;

  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: entry.feature,
      description: entry.detail,
      entry,
    })),
    {
      title: userMessage('message.environmentCheck.summary', available, unavailable),
      placeHolder: userMessage('message.environmentCheck.pickSetting'),
    },
  );

  if (picked?.entry.settingId !== undefined) {
    await vscode.commands.executeCommand('workbench.action.openSettings', picked.entry.settingId);
  }
}
