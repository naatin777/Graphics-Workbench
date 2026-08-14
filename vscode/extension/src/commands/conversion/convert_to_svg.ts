import path from 'node:path';

import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';

import {
  isDrawioImagePath,
  isNativeDrawioPath,
  logicalSourcePathForOutputTemplate,
} from '@graphics-workbench/core/formats';
import { resolveOutputPath } from '@graphics-workbench/core/output';
import { convertToSvgFiles, planPdfPageConversionInputs, type SvgInput } from '@graphics-workbench/core/conversion';
import { assertExistingPathInWorkspace } from '@graphics-workbench/core/security';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import type { ConversionExecutionContext } from '@graphics-workbench/core/runtime';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { assertLocalFileUri } from '../shared/command_input.js';
import { createDrawioBackend } from '../../config/rendering/drawio_cli_options.js';
import type { LocaleKeyType } from '../../locale_map.js';
import { userMessage } from '../shared/user_messages.js';

export async function convertToSvgCommand(sourceUris: vscode.Uri[], dependencies: CommandDependencies): Promise<void> {
  const { outputChannel } = dependencies;
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage('No files were selected.');
    return;
  }

  await runConversionLifecycle({
    operationName: 'convert-to-svg',
    outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages('SVG', sourceUris.length),
    run: async (runtime) => {
      const configuration = dependencies.getConfiguration();
      const maxInputPixels = configuration.raster.maxInputPixels();
      const drawioTools = createDrawioBackend(configuration);
      const inputs: SvgInput[] = [];
      for (const sourceUri of sourceUris) {
        inputs.push(...(await planSvgInputs(sourceUri, configuration, runtime)));
      }
      return convertToSvgFiles({
        inputs,
        maxInputPixels,
        drawioTools,
        runtime,
      });
    },
  });
}

async function planSvgInputs(
  sourceUri: vscode.Uri,
  configuration: Configuration,
  runtime: ConversionExecutionContext,
): Promise<SvgInput[]> {
  assertLocalFileUri(sourceUri);
  const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspace) {
    throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
  }

  const sourcePath = sourceUri.fsPath;
  const extension = path.extname(sourcePath).toLowerCase();

  if (extension === '.svg' && !isDrawioImagePath(sourcePath)) {
    throw new Error(`Unsupported input for SVG input: ${sourcePath}`);
  }

  if (extension === '.pdf') {
    await assertExistingPathInWorkspace(sourcePath, workspace.uri.fsPath);
    return planPdfPageSvgInputs(sourcePath, workspace, configuration, runtime);
  }

  if (isNativeDrawioPath(sourcePath)) {
    const outputTemplate = configuration.outputPath.single.svg();
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

  const page = isDrawioImagePath(sourcePath) ? '1' : undefined;
  const outputTemplate = configuration.outputPath.single.svg();
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

async function planPdfPageSvgInputs(
  sourcePath: string,
  workspace: vscode.WorkspaceFolder,
  configuration: Configuration,
  runtime: ConversionExecutionContext,
): Promise<SvgInput[]> {
  const outputTemplate = configuration.outputPath.split.svg();
  return planPdfPageConversionInputs({
    sourcePath,
    workspacePath: workspace.uri.fsPath,
    workspaceName: workspace.name,
    outputTemplate,
    allowedExtensions: ['.svg'],
    ...(runtime.signal !== undefined && { signal: runtime.signal }),
    report: (message) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- コア由来の既知メッセージキーをロケール境界で絞り込む。
      runtime.reportMessage?.(userMessage(message as LocaleKeyType));
    },
    toConversion: (page, outputPath) => ({ sourcePath, workspacePath: workspace.uri.fsPath, outputPath, page }),
  });
}
