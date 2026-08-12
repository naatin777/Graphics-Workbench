import * as vscode from 'vscode';

import { combineImagesToPdf } from '@graphics-workbench/core/conversion';
import { assertWritablePathInWorkspace } from '@graphics-workbench/core/security';
import type { Configuration } from '../../generated/extension_manifest.js';
import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';
import { assertRandomTemplateForCombine, createRandomToken, resolveOutputPath } from '@graphics-workbench/core/output';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { createSvgToPdfBackend } from './convert_to_pdf.js';
import { createOutputConversionMessages, runConversionLifecycle } from '../lifecycle/run_output_conversion.js';
import { resolveOutputConflicts } from '../lifecycle/safe_mode.js';
import { userMessage } from '../shared/user_messages.js';
import { localeMap } from '../../locale_map.js';

export async function combineImagesToPdfCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;

  try {
    if (sourceUris.length < 2) {
      await vscode.window.showErrorMessage(userMessage('message.combineImagesToPdf.requiresTwo'));
      return;
    }

    const previewedUris = await previewCombineInputs(sourceUris, () =>
      vscode.window.createQuickPick<CombinePreviewItem>(),
    );
    if (previewedUris === undefined) {
      return;
    }

    if (previewedUris.length < 2) {
      await vscode.window.showErrorMessage(userMessage('message.combineImagesToPdf.requiresTwo'));
      return;
    }

    const workspaceFolder = requireSingleWorkspace(previewedUris);
    const workspacePath = workspaceFolder.uri.fsPath;
    const configuration = dependencies.getConfiguration();

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(workspaceFolder.uri, 'combined.pdf'),
      filters: { 'PDF files': ['pdf'] },
    });
    if (!saveUri) {
      return;
    }

    assertOutputInsideWorkspace(saveUri, workspaceFolder);
    const outputPath = saveUri.fsPath;
    await assertWritablePathInWorkspace(outputPath, workspacePath);

    await runCombineConversion({
      sourceUris: previewedUris,
      outputPath,
      workspacePath,
      configuration,
      outputChannel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'PDF', message));
  }
}

export async function quickCombineImagesToPdfCommand(
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
): Promise<void> {
  const outputChannel = dependencies.outputChannel;

  try {
    if (sourceUris.length < 2) {
      await vscode.window.showErrorMessage(userMessage('message.combineImagesToPdf.requiresTwo'));
      return;
    }

    const workspaceFolder = requireSingleWorkspace(sourceUris);
    const workspacePath = workspaceFolder.uri.fsPath;
    const configuration = dependencies.getConfiguration();
    const outputTemplate = configuration.outputPath.combine.pdf();
    assertRandomTemplateForCombine(outputTemplate);
    const [firstSource] = sourceUris;
    if (firstSource === undefined) {
      throw new Error('Combine requires at least two source files.');
    }
    const outputPath = resolveOutputPath(
      outputTemplate,
      {
        sourcePath: firstSource.fsPath,
        workspacePath,
        workspaceName: workspaceFolder.name,
        random: createRandomToken(),
      },
      { allowedExtensions: ['.pdf'] },
    );
    await assertWritablePathInWorkspace(outputPath, workspacePath);

    await runCombineConversion({
      sourceUris,
      outputPath,
      workspacePath,
      configuration,
      outputChannel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(userMessage('message.convertToOutput.failed', 'PDF', message));
  }
}

async function runCombineConversion(options: {
  sourceUris: vscode.Uri[];
  outputPath: string;
  workspacePath: string;
  configuration: Configuration;
  outputChannel: LineOutputChannel;
}): Promise<void> {
  const { configuration } = options;
  const svgToPdfTools = createSvgToPdfBackend(configuration);
  const inputs = options.sourceUris.map((sourceUri) => ({ sourcePath: sourceUri.fsPath }));

  await runConversionLifecycle({
    operationName: 'combine-images-to-pdf',
    outputChannel: options.outputChannel,
    resolveConflicts: resolveOutputConflicts,
    messages: createOutputConversionMessages('PDF', inputs.length),
    run: async (runtime) =>
      combineImagesToPdf({
        inputs,
        outputPath: options.outputPath,
        workspacePath: options.workspacePath,
        runtime,
        maxInputPixels: configuration.raster.maxInputPixels(),
        tools: { svgToPdfTools },
        platform: process.platform,
      }),
  });
}

export interface CombinePreviewItem extends vscode.QuickPickItem {
  sourceUri: vscode.Uri;
  removeButton: vscode.QuickInputButton;
  moveUpButton: vscode.QuickInputButton;
  moveDownButton: vscode.QuickInputButton;
}

export type CombineQuickPickFactory = () => vscode.QuickPick<CombinePreviewItem>;

export async function previewCombineInputs(
  sourceUris: vscode.Uri[],
  createQuickPick: CombineQuickPickFactory,
): Promise<vscode.Uri[] | undefined> {
  const quickPick = createQuickPick();
  const removeButton = { iconPath: new vscode.ThemeIcon('close'), tooltip: localeMap('quickPick.combine.remove') };
  const moveUpButton = { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: localeMap('quickPick.combine.moveUp') };
  const moveDownButton = {
    iconPath: new vscode.ThemeIcon('arrow-down'),
    tooltip: localeMap('quickPick.combine.moveDown'),
  };
  const items = sourceUris.map((sourceUri) => ({
    label: pathLabel(sourceUri),
    sourceUri,
    removeButton,
    moveUpButton,
    moveDownButton,
  }));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result?: vscode.Uri[]): void => {
      if (settled) {
        return;
      }
      settled = true;
      quickPick.hide();
      quickPick.dispose();
      resolve(result);
    };

    const refresh = (): void => {
      quickPick.items = items.map((item, index) => ({
        ...item,
        label: `${index + 1}. ${pathLabel(item.sourceUri)}`,
        buttons: [item.moveUpButton, item.moveDownButton, item.removeButton],
      }));
    };

    quickPick.title = localeMap('quickPick.combine.title');
    quickPick.placeholder = localeMap('quickPick.combine.placeholder');
    quickPick.ignoreFocusOut = true;
    quickPick.onDidTriggerItemButton(({ item, button }) => {
      const index = items.findIndex((candidate) => candidate.sourceUri.toString() === item.sourceUri.toString());
      if (index < 0) {
        return;
      }
      if (button === item.removeButton) {
        items.splice(index, 1);
      } else if (button === item.moveUpButton && index > 0) {
        const currentItem = items[index];
        const previousItem = items[index - 1];
        if (currentItem === undefined || previousItem === undefined) {
          return;
        }
        [items[index - 1], items[index]] = [currentItem, previousItem];
      } else if (button === item.moveDownButton && index < items.length - 1) {
        const currentItem = items[index];
        const nextItem = items[index + 1];
        if (currentItem === undefined || nextItem === undefined) {
          return;
        }
        [items[index], items[index + 1]] = [nextItem, currentItem];
      }
      refresh();
    });
    quickPick.onDidAccept(() => {
      finish(items.length > 0 ? items.map((item) => item.sourceUri) : undefined);
    });
    quickPick.onDidHide(() => {
      finish();
    });
    refresh();
    quickPick.show();
  });
}

function pathLabel(uri: vscode.Uri): string {
  return uri.fsPath.split(/[\\/]/u).at(-1) ?? uri.fsPath;
}

function requireSingleWorkspace(sourceUris: vscode.Uri[]): vscode.WorkspaceFolder {
  for (const sourceUri of sourceUris) {
    if (sourceUri.scheme !== 'file') {
      throw new Error(`Only local files are supported: ${sourceUri.toString()}`);
    }
  }

  const [firstSource] = sourceUris;
  if (firstSource === undefined) {
    throw new Error('combineImagesToPdf requires at least two source files.');
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(firstSource);

  if (!workspaceFolder) {
    throw new Error(`The file must be inside an open workspace: ${firstSource.fsPath}`);
  }

  for (const sourceUri of sourceUris.slice(1)) {
    const sourceWorkspace = vscode.workspace.getWorkspaceFolder(sourceUri);
    if (!sourceWorkspace || sourceWorkspace.uri.toString() !== workspaceFolder.uri.toString()) {
      throw new Error(`All selected files must be inside the same open workspace: ${sourceUri.fsPath}`);
    }
  }

  return workspaceFolder;
}

function assertOutputInsideWorkspace(outputUri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): void {
  if (outputUri.scheme !== 'file') {
    throw new Error(`Only local output files are supported: ${outputUri.toString()}`);
  }

  const outputWorkspace = vscode.workspace.getWorkspaceFolder(outputUri);
  if (!outputWorkspace || outputWorkspace.uri.toString() !== workspaceFolder.uri.toString()) {
    throw new Error(`The output file must be inside the selected workspace: ${outputUri.fsPath}`);
  }
}
