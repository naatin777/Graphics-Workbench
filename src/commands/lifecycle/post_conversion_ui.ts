import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { toErrorMessage } from '../../shared/error.js';

/** Keeps notification/action failures outside the already-committed conversion failure boundary. */
export async function runPostConversionUi(
  operationName: string,
  outputChannel: LineOutputChannel | undefined,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    try {
      outputChannel?.appendLine(`[${operationName}] success notification failed: ${toErrorMessage(error)}`);
    } catch {
      // A best-effort diagnostic must not cross back into the conversion failure boundary.
    }
  }
}
