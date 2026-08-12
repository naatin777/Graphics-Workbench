import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '@graphics-workbench/core/output';
import { localeMap } from '../../locale_map.js';
import { decryptPdfFiles, type DecryptPdfInput } from '@graphics-workbench/core/pdf';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { isAbortError } from '@graphics-workbench/core/runtime';

export async function decryptPdfCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  try {
    if (sourceUris.length === 0) {
      throw new Error('No PDF files were selected.');
    }

    const password = await promptForPassword();

    if (password === undefined) {
      return;
    }

    const configuration = dependencies.getConfiguration();
    const outputTemplate = configuration.outputPath.decryptPdf();
    const inputs = sourceUris.map((sourceUri) => planDecryptPdfInput(sourceUri, outputTemplate));
    await runConversionLifecycle({
      operationName: 'decrypt-pdf',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.decryptPdf.title', inputs.length),
        prepareMessage: userMessage('message.progress.prepareDecryptPdf'),
        successMessage: (count) => userMessage('message.decryptPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.decryptPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.decryptPdf.failed', reason),
      },
      run: async (runtime) => decryptPdfFiles({ inputs, password, runtime }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.decryptPdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.decryptPdf.failed', message));
  }
}

async function promptForPassword(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: localeMap('prompt.decryptPdf.password'),
    password: true,
    ignoreFocusOut: true,
  });
}

function planDecryptPdfInput(sourceUri: vscode.Uri, outputTemplate: string): DecryptPdfInput {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Only PDF files can be decrypted: ${sourcePath}`);
  }

  return {
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    outputPath: resolvePdfOutputPath(outputTemplate, {
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      sourcePath,
    }),
  };
}
