import * as vscode from 'vscode';

import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import { toErrorMessage, isAbortError } from '@graphics-workbench/core/runtime';

export interface ReportConfigureApplyErrorOptions {
  operationName: string;
  // oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
  error: unknown;
  panel: vscode.WebviewPanel;
  cancelledMessage: string;
  failedMessage: (reason: string) => string;
  outputChannel?: LineOutputChannel;
  sendError: (message: string) => void;
}

export async function reportConfigureApplyError(options: ReportConfigureApplyErrorOptions): Promise<void> {
  const message = toErrorMessage(options.error);
  options.outputChannel?.appendLine(`[${options.operationName}] failure: ${message}`);
  if (isAbortError(options.error)) {
    await vscode.window.showInformationMessage(options.cancelledMessage);
    return;
  }
  try {
    options.sendError(message);
  } catch {
    // The panel may already be disposed; the error notification below still informs the user.
  }
  await vscode.window.showErrorMessage(options.failedMessage(message));
}
