import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '@graphics-workbench/core/output';
import { localeMap } from '../../locale_map.js';
import { encryptPdfFiles, type EncryptPdfInput } from '@graphics-workbench/core/pdf';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { isAbortError } from '@graphics-workbench/core/runtime';

export async function encryptPdfCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
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
    const outputTemplate = configuration.outputPath.encryptPdf();
    const inputs = sourceUris.map((sourceUri) => planEncryptPdfInput(sourceUri, outputTemplate));
    await runConversionLifecycle({
      operationName: 'encrypt-pdf',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.encryptPdf.title', inputs.length),
        prepareMessage: userMessage('message.progress.prepareEncryptPdf'),
        successMessage: (count) => userMessage('message.encryptPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.encryptPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.encryptPdf.failed', reason),
      },
      run: async (runtime) => encryptPdfFiles({ inputs, password, runtime }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.encryptPdf.cancelled'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.encryptPdf.failed', message));
  }
}

async function promptForPassword(): Promise<string | undefined> {
  const password = await vscode.window.showInputBox({
    title: localeMap('prompt.encryptPdf.password'),
    password: true,
    ignoreFocusOut: true,
  });

  if (password === undefined) {
    return undefined;
  }

  const confirmation = await vscode.window.showInputBox({
    title: localeMap('prompt.encryptPdf.passwordConfirmation'),
    password: true,
    ignoreFocusOut: true,
  });

  if (confirmation === undefined) {
    return undefined;
  }

  if (password !== confirmation) {
    await vscode.window.showErrorMessage(userMessage('message.encryptPdf.passwordMismatch'));
    return undefined;
  }

  if (password.includes(',') || password.includes('=')) {
    await vscode.window.showErrorMessage(userMessage('message.encryptPdf.passwordUnsupportedCharacters'));
    return undefined;
  }

  return password;
}

function planEncryptPdfInput(sourceUri: vscode.Uri, outputTemplate: string): EncryptPdfInput {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local PDF files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);

  if (!workspace) {
    throw new Error(`The PDF must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;

  if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Only PDF files can be encrypted: ${sourcePath}`);
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
