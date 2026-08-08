import type { LineOutputChannel } from '../../external_tools/external_tool_ascii_scratch.js';
import { runExternalTool } from '../../external_tools/run_external_tool.js';

export type RunDrawio = (
  executable: string,
  args: string[],
  signal?: AbortSignal,
  outputChannel?: LineOutputChannel,
) => Promise<void>;

export interface DrawioBackend {
  drawioPath: string;
  runDrawio?: RunDrawio;
}

export async function executeDrawio(
  executable: string,
  args: string[],
  signal?: AbortSignal,
  outputChannel?: LineOutputChannel,
): Promise<void> {
  const toolOptions: Parameters<typeof runExternalTool>[0] = { toolName: 'drawio', executable, args };
  if (signal !== undefined) {
    toolOptions.signal = signal;
  }
  if (outputChannel !== undefined) {
    toolOptions.outputChannel = outputChannel;
  }
  await runExternalTool(toolOptions);
}
