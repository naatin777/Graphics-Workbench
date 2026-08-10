import * as vscode from 'vscode';

import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { toErrorMessage, isAbortError } from '../../shared/error.js';

export interface ReportConfigureApplyErrorOptions {
  operationName: string;
  // oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
  error: unknown;
  panel: vscode.WebviewPanel;
  cancelledMessage: string;
  failedMessage: (reason: string) => string;
  outputChannel?: LineOutputChannel;
}

export async function reportConfigureApplyError(options: ReportConfigureApplyErrorOptions): Promise<void> {
  const message = toErrorMessage(options.error);
  options.outputChannel?.appendLine(`[${options.operationName}] failure: ${message}`);
  if (isAbortError(options.error)) {
    await vscode.window.showInformationMessage(options.cancelledMessage);
    return;
  }
  try {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Webview.postMessage has no targetOrigin parameter.
    void options.panel.webview.postMessage({ type: 'error', payload: { message } });
  } catch {
    // The panel may already be disposed; the error notification below still informs the user.
  }
  await vscode.window.showErrorMessage(options.failedMessage(message));
}
