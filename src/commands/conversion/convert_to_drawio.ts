import * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { readDrawioExecutablePath } from '../../config/external_tools/external_tool_paths.js';
import { getMaxInputPixels } from '../../config/raster.js';
import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import { convertToDrawioFiles, type ConvertToDrawioJob } from '../../operations/conversion/convert_to_drawio.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { assertLocalFileUri, resolveSelectedUris } from '../shared/command_input.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';

const drawioExtensions = ['.drawio', '.dio', '.drawio.png', '.dio.png', '.drawio.svg', '.dio.svg'] as const;

export async function convertToDrawioCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(uri, uris, dependencies, (configuration) =>
    configuration.outputPath.convertToDrawio(),
  );
}

export async function convertToDrawioPngCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(uri, uris, dependencies, (configuration) =>
    configuration.outputPath.convertToDrawioPng(),
  );
}

export async function convertToDrawioSvgCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runDrawioConversionCommand(uri, uris, dependencies, (configuration) =>
    configuration.outputPath.convertToDrawioSvg(),
  );
}

async function runDrawioConversionCommand(
  uri: vscode.Uri | undefined,
  uris: vscode.Uri[] | undefined,
  dependencies: CommandDependencies | undefined,
  setting: (configuration: Configuration) => string,
): Promise<void> {
  try {
    const sourceUris = resolveSelectedUris(uri, uris);
    if (sourceUris.length === 0) {
      throw new Error('No files were selected.');
    }
    const configuration = configureCommandRuntime(dependencies);
    const [first] = sourceUris;
    if (first === undefined) {
      throw new Error('No files were selected.');
    }
    assertLocalFileUri(first);
    const workspace = vscode.workspace.getWorkspaceFolder(first);
    if (!workspace) {
      throw new Error(`The file must be inside an open workspace: ${first.fsPath}`);
    }
    const template = setting(configuration);
    const outputPath = resolveOutputPath(
      template,
      {
        sourcePath: first.fsPath,
        workspacePath: workspace.uri.fsPath,
        workspaceName: workspace.name,
      },
      { allowedExtensions: drawioExtensions },
    );
    const drawioPath = readDrawioExecutablePath(configuration);
    const jobs: ConvertToDrawioJob[] = [
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
    await runConversionLifecycle({
      operationName: 'convert-to-drawio',
      ...(dependencies?.outputChannel !== undefined && { outputChannel: dependencies.outputChannel }),
      resolveConflicts: resolveOutputConflicts,
      messages: createOutputConversionMessages('Draw.io', sourceUris.length),
      run: async (runtime) =>
        convertToDrawioFiles({
          jobs,
          tools: {
            drawioPath,
            mermaidTools: readMermaidCliOptions(configuration),
          },
          maxInputPixels: getMaxInputPixels(configuration),
          runtime,
        }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Failed to create Draw.io file: ${message}`);
  }
}
