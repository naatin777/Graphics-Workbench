import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runExternalTool, type ExternalToolResult } from '../external_tools/run_external_tool.js';
import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';

export interface QpdfJobJson {
  inputFile: string;
  outputFile: string;
  password?: string;
  /** Equivalent to qpdf's `--decrypt` flag (`"decrypt": ""` in Job JSON). */
  decrypt?: '';
  encrypt?: {
    userPassword: string;
    ownerPassword: string;
    '256bit': Record<string, never>;
  };
}

/** Runs qpdf with secrets in a private job-json file instead of process argv. */
export async function runQpdfWithJobJson(options: {
  qpdfPath: string;
  job: QpdfJobJson;
  signal?: AbortSignal;
  outputChannel?: LineOutputChannel;
  timeoutMs?: number;
  runTool?: typeof runExternalTool;
  temporaryDirectory?: string;
}): Promise<ExternalToolResult> {
  const ownsArgumentDirectory = options.temporaryDirectory === undefined;
  const argumentDirectory =
    options.temporaryDirectory ?? (await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-qpdf-')));
  const argumentFile = path.join(argumentDirectory, `.qpdf-job-${crypto.randomUUID()}.json`);

  try {
    await chmod(argumentDirectory, 0o700).catch(() => {
      // Windows uses the ACL inherited from the per-user temporary directory.
    });
    await writeFile(argumentFile, JSON.stringify(options.job), { mode: 0o600 });

    const runOptions: Parameters<typeof runExternalTool>[0] = {
      toolName: 'qpdf',
      executable: options.qpdfPath,
      args: [`--job-json-file=${argumentFile}`],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.outputChannel === undefined ? {} : { outputChannel: options.outputChannel }),
      redactArgument: () => '<job-json-file>',
    };
    if (options.timeoutMs !== undefined) {
      runOptions.timeoutMs = options.timeoutMs;
    }
    return await (options.runTool ?? runExternalTool)(runOptions);
  } finally {
    await (ownsArgumentDirectory
      ? rm(argumentDirectory, { recursive: true, force: true })
      : rm(argumentFile, { force: true }));
  }
}
