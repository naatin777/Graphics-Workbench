import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import {
  isNativeDrawioPath,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../application/policy/source_format.js';
import { readGhostscriptExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { resolveConversionTemplate } from './conversion_routing.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { convertToEpsFiles, type ConvertToEpsJob } from '../../operations/conversion/convert_to_eps.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { assertLocalFileUri, resolveSelectedUris } from '../shared/command_input.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';
import { isAbortError } from '../../application/error_utils.js';
import { createRasterFrameJobs } from './create_raster_frame_jobs.js';
import { readSvgToPdfOptions } from './convert_to_pdf.js';

const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.eps';

export async function convertToEpsCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  try {
    const sourceUris = resolveSelectedUris(uri, uris);
    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }
    const configuration = configureCommandRuntime(dependencies);
    const jobs: ConvertToEpsJob[] = [];
    for (const sourceUri of sourceUris) {
      jobs.push(...(await createEpsJobs(sourceUri, configuration)));
    }
    const svgToPdfTools = readSvgToPdfOptions(configuration);
    await runConversionLifecycle({
      operationName: 'convert-to-eps',
      ...(dependencies?.outputChannel === undefined ? {} : { outputChannel: dependencies.outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('EPS', sourceUris.length),
      run: async (runtime) =>
        convertToEpsFiles({
          jobs,
          runtime,
          tools: {
            ghostscriptPath: readGhostscriptExecutablePath(configuration),
            svgToPdfTools,
            mermaidTools: readMermaidCliOptions(configuration),
          },
          maxInputPixels: getMaxInputPixels(configuration),
          platform: process.platform,
        }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Failed to convert to EPS: ${message}`);
  }
}

export async function createEpsJobs(sourceUri: vscode.Uri, configuration: Configuration): Promise<ConvertToEpsJob[]> {
  assertLocalFileUri(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }
  const sourcePath = sourceUri.fsPath;
  if (path.extname(sourcePath).toLowerCase() === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    const document = await PDFDocument.load(await readFile(sourcePath));
    const pageCount = document.getPageCount();
    if (pageCount === 0) {
      throw new Error(`PDF has no pages: ${sourcePath}`);
    }
    const template = resolveOutputPathsTemplate(configuration, 'convertPdfToEps', defaultPdfOutputPath);
    assertPageTemplateForSplitOutput(template, pageCount);
    return Array.from({ length: pageCount }, (_value, index) =>
      planEpsConversionJob(sourcePath, workspace, template, index + 1, pageCount),
    );
  }

  if (isNativeDrawioPath(sourcePath)) {
    throw new Error(`Native Draw.io input is not supported for EPS conversion: ${sourcePath}`);
  }

  const outputTemplate = outputPathTemplateForSource(sourcePath, configuration);

  if (isRasterImagePath(sourcePath)) {
    return createRasterFrameJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate,
      allowedExtensions: ['.eps'],
      maxInputPixels: getMaxInputPixels(configuration),
      createJob: (job) => job,
    });
  }
  return [
    {
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      outputPath: resolveOutputPath(
        outputTemplate,
        {
          sourcePath: logicalSourcePathForOutputTemplate(sourcePath),
          workspacePath: workspace.uri.fsPath,
          workspaceName: workspace.name,
        },
        { allowedExtensions: ['.eps'] },
      ),
    },
  ];
}

function outputPathTemplateForSource(sourcePath: string, configuration: Configuration): string {
  return resolveConversionTemplate({
    target: 'eps',
    sourcePath,
    configuration,
  });
}

function planEpsConversionJob(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  template: string,
  page: number,
  totalPages: number,
): ConvertToEpsJob {
  return {
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    outputPath: resolveOutputPath(
      template,
      {
        sourcePath,
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
        page: formatOutputPage(page, totalPages),
      },
      { allowedExtensions: ['.eps'] },
    ),
    page,
  };
}
