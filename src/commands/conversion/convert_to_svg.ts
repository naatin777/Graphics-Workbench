import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { countPdfPages, renderPdfPageToSvg } from '../../operations/pdf/mupdf.js';
import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  logicalSourcePathForOutputTemplate,
} from '../../shared/source_format.js';
import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { convertToSvgFiles, type ConvertToSvgJob } from '../../operations/conversion/convert_to_svg.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { assertLocalFileUri } from '../shared/command_input.js';
import { buildDrawioCommandOptions } from '../shared/command_runtime.js';
import { isAbortError } from '../../shared/error.js';

export async function convertToSvgCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const outputChannel = dependencies.outputChannel;
  try {
    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }

    const configuration = dependencies.getConfiguration();
    const maxInputPixels = configuration.raster.maxInputPixels();
    const mermaidTools = readMermaidCliOptions(configuration);
    const drawioTools = buildDrawioCommandOptions(configuration);
    await runConversionLifecycle({
      operationName: 'convert-to-svg',
      outputChannel,
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('SVG', sourceUris.length),
      run: async (runtime) => {
        const jobs: ConvertToSvgJob[] = [];
        for (const sourceUri of sourceUris) {
          runtime.signal?.throwIfAborted();
          jobs.push(...(await planSvgConversionJobs(sourceUri, configuration, runtime)));
        }
        return convertToSvgFiles({
          jobs,
          maxInputPixels,
          mermaidTools,
          drawioTools,
          runtime,
          runPdfToSvg: async (sourcePath, outputPath, page, signal) => {
            signal.throwIfAborted();
            const svg = await renderPdfPageToSvg(await readFile(sourcePath), page);
            signal.throwIfAborted();
            await writeFile(outputPath, svg, 'utf8');
          },
        });
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      await vscode.window.showInformationMessage(userMessage('message.convertToOutput.cancelled', 'SVG'));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'SVG', message));
  }
}

async function planSvgConversionJobs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  runtime?: ConversionExecutionContext,
): Promise<ConvertToSvgJob[]> {
  assertLocalFileUri(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if (extension === '.svg' && !isEditableDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for SVG conversion: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return planPdfPageSvgJobs(sourcePath, workspace, configuration, runtime);
  }

  if (isNativeDrawioPath(sourcePath)) {
    const outputTemplate = resolveConversionTemplate({ target: 'svg', sourcePath, configuration });
    const outputPath = resolveOutputPath(
      outputTemplate,
      {
        sourcePath,
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
      },
      { allowedExtensions: ['.svg'] },
    );
    return [{ sourcePath, workspacePath: workspace.uri.fsPath, outputPath }];
  }

  const page = isEditableDrawioImagePath(sourcePath) ? '1' : undefined;
  const outputTemplate = outputTemplateForSource(sourcePath, configuration);
  const outputPath = resolveOutputPath(
    outputTemplate,
    {
      sourcePath: logicalSourcePathForOutputTemplate(sourcePath),
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      ...(page !== undefined && { page }),
    },
    { allowedExtensions: ['.svg'] },
  );

  return [
    {
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      outputPath,
      ...(page !== undefined && { page: Number(page) }),
    },
  ];
}

async function planPdfPageSvgJobs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  configuration: Configuration,
  runtime?: ConversionExecutionContext,
): Promise<ConvertToSvgJob[]> {
  runtime?.signal?.throwIfAborted();
  runtime?.reportMessage?.(userMessage('message.progress.analyzingPdf'));
  const pageCount = await countPdfPages(await readFile(sourcePath));

  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${sourcePath}`);
  }

  const outputTemplate = resolveConversionTemplate({ target: 'svg', sourcePath, configuration });
  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  const jobs: ConvertToSvgJob[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    runtime?.signal?.throwIfAborted();
    const page = index + 1;
    jobs.push({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      outputPath: resolveOutputPath(
        outputTemplate,
        {
          sourcePath,
          workspacePath: workspace.uri.fsPath,
          workspaceName: workspace.name,
          page: formatOutputPage(page, pageCount),
        },
        { allowedExtensions: ['.svg'] },
      ),
      page,
    });
  }

  return jobs;
}

function outputTemplateForSource(sourcePath: string, configuration: Configuration): string {
  return resolveConversionTemplate({
    target: 'svg',
    sourcePath,
    configuration,
  });
}
