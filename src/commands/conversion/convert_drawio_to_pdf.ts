import * as vscode from 'vscode';

import { isDrawioPath } from '../../shared/source_format.js';
import { resolveOutputPathTemplate } from '../../config/output/output_path_settings.js';
import { assertPageTemplateForSplitOutput } from '../../config/output/page_template.js';
import { convertDrawioToPdfFiles, type DrawioPdfJob } from '../../operations/conversion/convert_drawio_to_pdf.js';
import { executeDrawio } from '../../operations/conversion/tools/drawio_tools.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { userMessage } from '../shared/user_messages.js';

const defaultOutputPath = '${fileDirname}/${fileBasenameNoExtension}/${page}.pdf';
const defaultSingleOutputPath = '${fileDirname}/${fileBasenameNoExtension}.pdf';

export async function convertDrawioToPagePdfsCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioPdfCommand(sourceUris, 'page-pdfs', 'convert-drawio-to-pdf', dependencies);
}

export async function convertDrawioToSinglePdfCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioPdfCommand(sourceUris, 'single-pdf', 'convert-drawio-to-single-pdf', dependencies);
}

async function runDrawioPdfCommand(
  sourceUris: vscode.Uri[],
  outputMode: 'page-pdfs' | 'single-pdf',
  operationName: string,
  dependencies: CommandDependencies,
): Promise<void> {
  try {
    if (sourceUris.length === 0) {
      throw new Error('No Draw.io files were selected.');
    }

    const configuration = dependencies.getConfiguration();
    const outputTemplate = resolveOutputPathTemplate(
      outputMode === 'page-pdfs'
        ? configuration.outputPath.convertDrawioToPagePdfs()
        : configuration.outputPath.convertDrawioToSinglePdf(),
      outputMode === 'page-pdfs' ? defaultOutputPath : defaultSingleOutputPath,
    );
    if (outputMode === 'page-pdfs') {
      assertPageTemplateForSplitOutput(outputTemplate, 2);
    }
    const jobs = sourceUris.map((sourceUri) => planDrawioPdfJob(sourceUri, outputTemplate));
    const drawioPath = configuration.execPath.drawio();

    await runConversionLifecycle({
      operationName,
      outputChannel: dependencies.outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: {
        progressTitle: userMessage(
          outputMode === 'page-pdfs'
            ? 'message.progress.convertDrawioToPagePdfs.title'
            : 'message.progress.convertDrawioToSinglePdf.title',
          jobs.length,
        ),
        prepareMessage: userMessage('message.progress.prepareConversion', 'Draw.io PDF'),
        successMessage: (count) =>
          userMessage(
            outputMode === 'page-pdfs'
              ? 'message.convertDrawioToPagePdfs.success'
              : 'message.convertDrawioToSinglePdf.success',
            count,
          ),
        undoUnavailableMessage: (success, reason) => userMessage('message.undoUnavailable', success, reason),
        cancelledMessage: userMessage(
          outputMode === 'page-pdfs'
            ? 'message.convertDrawioToPagePdfs.cancelled'
            : 'message.convertDrawioToSinglePdf.cancelled',
        ),
        failedMessage: (reason) =>
          userMessage(
            outputMode === 'page-pdfs'
              ? 'message.convertDrawioToPagePdfs.failed'
              : 'message.convertDrawioToSinglePdf.failed',
            reason,
          ),
      },
      run: async (runtime) =>
        convertDrawioToPdfFiles({
          jobs,
          drawioPath,
          outputMode,
          runDrawio: executeDrawio,
          runtime,
        }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(
      userMessage(
        outputMode === 'page-pdfs'
          ? 'message.convertDrawioToPagePdfs.failed'
          : 'message.convertDrawioToSinglePdf.failed',
        message,
      ),
    );
  }
}

function planDrawioPdfJob(sourceUri: vscode.Uri, outputTemplate: string): DrawioPdfJob {
  if (sourceUri.scheme !== 'file') {
    throw new Error(`Only local Draw.io files are supported: ${sourceUri.toString()}`);
  }

  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The Draw.io file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  if (!isDrawioPath(sourceUri.fsPath)) {
    throw new Error(`Only Draw.io files are supported: ${sourceUri.fsPath}`);
  }

  return {
    sourcePath: sourceUri.fsPath,
    outputTemplate,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
  };
}
