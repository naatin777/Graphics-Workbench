import path from 'node:path';

import * as vscode from 'vscode';

import { resolvePdfOutputPath } from '../../config/output/resolve_output_path.js';
import { localeMap } from '../../locale_map.js';
import { decryptPdfFiles, type DecryptPdfJob } from '../../operations/pdf/decrypt_pdf.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { isAbortError } from '../../application/error_normalization.js';
import { resolveSelectedUris } from '../shared/command_input.js';

export async function decryptPdfCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies?.outputChannel;
  try {
    const sourceUris = resolveSelectedUris(uri, uris);

    if (sourceUris.length === 0) {
      throw new Error('No PDF files were selected.');
    }

    const password = await promptForPassword();

    if (password === undefined) {
      return;
    }

    const configuration = configureCommandRuntime(dependencies);
    const outputTemplate = configuration.outputPath.decryptPdf();
    const jobs = sourceUris.map((sourceUri) => planDecryptPdfJob(sourceUri, outputTemplate));
    await runConversionLifecycle({
      operationName: 'decrypt-pdf',
      ...(outputChannel !== undefined && { outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage('message.progress.decryptPdf.title', jobs.length),
        prepareMessage: userMessage('message.progress.prepareDecryptPdf'),
        successMessage: (count) => userMessage('message.decryptPdf.success', count),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage('message.decryptPdf.cancelled'),
        failedMessage: (reason) => userMessage('message.decryptPdf.failed', reason),
      },
      run: async (runtime) => decryptPdfFiles({ jobs, password, runtime }),
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

function planDecryptPdfJob(sourceUri: vscode.Uri, outputTemplate: string): DecryptPdfJob {
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
