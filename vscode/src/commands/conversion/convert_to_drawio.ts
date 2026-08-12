import * as vscode from 'vscode';
import { readFile, writeFile } from 'node:fs/promises';

import type { Configuration } from '../../generated/extension_manifest.js';
import { resolveOutputPath } from '@graphics-workbench/core/config/output/resolve_output_path.js';
import { convertToDrawioFiles, type DrawioComposeInput } from '../../operations/conversion/convert_to_drawio.js';
import { renderPdfPageToSvg } from '@graphics-workbench/core/operations/pdf/mupdf.js';
import { executeDrawio } from '@graphics-workbench/core/operations/conversion/tools/drawio_tools.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { assertLocalFileUri } from '../shared/command_input.js';

const drawioExtensions = ['.drawio', '.dio', '.drawio.png', '.dio.png', '.drawio.svg', '.dio.svg'] as const;

export async function convertToDrawioCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(sourceUris, dependencies, (configuration) =>
    configuration.outputPath.single.drawio(),
  );
}

export async function convertToDrawioPngCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(sourceUris, dependencies, (configuration) =>
    configuration.outputPath.single.drawioPng(),
  );
}

export async function convertToDrawioSvgCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(sourceUris, dependencies, (configuration) =>
    configuration.outputPath.single.drawioSvg(),
  );
}

async function runDrawioConversionCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
  setting: (configuration: Configuration) => string,
): Promise<void> {
  if (sourceUris.length === 0) {
    await vscode.window.showErrorMessage('No files were selected.');
    return;
  }

  await runConversionLifecycle({
    operationName: 'convert-to-drawio',
    outputChannel: dependencies.outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages('Draw.io', sourceUris.length),
    run: async (runtime) => {
      const configuration = dependencies.getConfiguration();
      const [first] = sourceUris;
      if (first === undefined) {
        throw new Error('No files were selected.');
      }
      assertLocalFileUri(first);
      const workspace = vscode.workspace.getWorkspaceFolder(first);
      if (!workspace) {
        throw new Error(`The file must be inside an open workspace: ${first.fsPath}`);
      }
      const outputPath = resolveOutputPath(
        setting(configuration),
        {
          sourcePath: first.fsPath,
          workspacePath: workspace.uri.fsPath,
          workspaceName: workspace.name,
        },
        { allowedExtensions: drawioExtensions },
      );
      const composeInputs: DrawioComposeInput[] = [
        {
          inputs: sourceUris.map((sourceUri) => {
            assertLocalFileUri(sourceUri);
            const inputWorkspace = vscode.workspace.getWorkspaceFolder(sourceUri);
            if (!inputWorkspace || inputWorkspace.uri.fsPath !== workspace.uri.fsPath) {
              throw new Error(`All files must be inside the same workspace: ${sourceUri.fsPath}`);
            }
            return { sourcePath: sourceUri.fsPath };
          }),
          outputPath,
          workspacePath: workspace.uri.fsPath,
        },
      ];
      runtime.signal?.throwIfAborted();
      return convertToDrawioFiles({
        inputs: composeInputs,
        tools: {
          drawioPath: configuration.execPath.drawio(),
          runPdfToSvg: async (sourcePath, toolOutputPath, page, signal) => {
            signal.throwIfAborted();
            const svg = await renderPdfPageToSvg(await readFile(sourcePath), page);
            signal.throwIfAborted();
            await writeFile(toolOutputPath, svg, 'utf8');
          },
          runDrawio: executeDrawio,
        },
        maxInputPixels: configuration.raster.maxInputPixels(),
        runtime,
      });
    },
  });
}
