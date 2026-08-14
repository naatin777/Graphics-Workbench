import { Result } from 'better-result';

import type { LineOutputChannel } from '../../external_tools/external_tool_ascii_scratch.js';
import {
  runExternalTool,
  ExternalToolSpawnError,
  type ExternalToolError,
} from '../../external_tools/run_external_tool.js';

export type RunDrawio = (
  executable: string,
  args: string[],
  signal: AbortSignal,
  outputChannel?: LineOutputChannel,
) => Promise<Result<void, ExternalToolError>>;

export interface DrawioBackend {
  drawioPath: string;
  runDrawio: RunDrawio;
}

export async function executeDrawio(
  executable: string,
  args: string[],
  signal: AbortSignal,
  outputChannel?: LineOutputChannel,
): Promise<Result<void, ExternalToolError>> {
  if (executable.trim() === '') {
    return Result.err(
      new ExternalToolSpawnError({
        message: 'Draw.io executable is not configured. Set graphics-workbench.execPath.drawio.',
        code: undefined,
        cause: undefined,
      }),
    );
  }
  const toolOptions: Parameters<typeof runExternalTool>[0] = {
    toolId: 'drawio',
    toolName: 'drawio',
    executable,
    args,
    signal,
  };
  if (outputChannel !== undefined) {
    toolOptions.outputChannel = outputChannel;
  }
  return (await runExternalTool(toolOptions)).map(() => undefined);
}
