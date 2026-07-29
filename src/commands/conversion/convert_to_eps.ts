import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { configs, getExtensionConfiguration } from '../../generated-extension-config.js';
import type { ConfigurationReader } from '../../generated-extension-meta.js';

import {
  isEditableDrawioImagePath,
  isNativeDrawioPath,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../application/policy/source_format.js';
import { readGhostscriptExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { getMaxInputPixels } from '../../config/raster_input.js';
import { readMermaidPuppeteerOptions } from '../../config/rendering/mermaid_puppeteer_options.js';
import { resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';
import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { convertToEpsFiles, type ConvertToEpsJob } from '../../operations/conversion/convert_to_eps.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { assertFileScheme, isAbortError, selectedUris } from '../shared/command_utils.js';
import { createRasterFrameJobs } from './create_raster_frame_jobs.js';
import { readSvgToPdfOptions } from './convert_to_pdf.js';

export const CONVERT_TO_EPS_COMMAND = 'graphics-workbench.convertToEps';
const defaultPdfOutputPath = '${fileDirname}/${fileBasenameNoExtension}-${page}.eps';

export async function convertToEpsCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  try {
    const sourceUris = selectedUris(uri, uris);
    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }
    const configuration = getExtensionConfiguration();
    const plannedJobs = await Promise.all(sourceUris.map(async (sourceUri) => createEpsJobs(sourceUri, configuration)));
    const jobs = plannedJobs.flat();
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
            mermaidTools: readMermaidPuppeteerOptions(configuration),
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

export async function createEpsJobs(
  sourceUri: vscode.Uri,
  configuration: ConfigurationReader,
): Promise<ConvertToEpsJob[]> {
  assertFileScheme(sourceUri);
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
    const outputTemplate = outputPathTemplateForSource(sourcePath);
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

  const outputTemplate = outputPathTemplateForSource(sourcePath);

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

function outputPathTemplateForSource(sourcePath: string): string {
  if (isEditableDrawioImagePath(sourcePath) || isNativeDrawioPath(sourcePath)) {
    return configs.outputPath.convertPngToEps();
  }
  switch (path.extname(sourcePath).toLowerCase()) {
    case '.png': {
      return configs.outputPath.convertPngToEps();
    }
    case '.jpg':
    case '.jpeg': {
      return configs.outputPath.convertJpegToEps();
    }
    case '.webp': {
      return configs.outputPath.convertWebpToEps();
    }
    case '.avif': {
      return configs.outputPath.convertAvifToEps();
    }
    case '.svg': {
      return configs.outputPath.convertSvgToEps();
    }
    case '.mmd':
    case '.mermaid': {
      return configs.outputPath.convertMermaidToEps();
    }
    default: {
      throw new Error(`Unsupported EPS input format: ${sourcePath}`);
    }
  }
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
