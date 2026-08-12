import * as vscode from 'vscode';

import { registerCommands } from './commands/shared/command_registrations.js';
import type { CommandDependencies } from './commands/shared/command_dependencies.js';
import { applyRuntimeConfiguration } from './commands/shared/command_runtime.js';
import { initializeSafeMode } from './commands/lifecycle/safe_mode.js';
import { initializeControlsPanel } from './commands/lifecycle/controls_panel.js';
import { LatexDropEditProvider } from './edit_provider/latex_drop_edit_provider.js';
import { LatexPasteEditProvider } from './edit_provider/latex_paste_edit_provider.js';
import { insertionDocumentSelectors, insertionFormats } from './edit_provider/insertion_format.js';
import { registerPreviewCustomEditors } from './commands/preview/preview_custom_editor.js';
import { getExtensionConfiguration } from './config/extension_configuration.js';
import { extensionIdentity } from './generated/extension_manifest.js';
import { sharedHeavyProcessLimiter } from '@graphics-workbench/core/external-tools';
import { cleanupStaleSecurePdfStagingRoots } from '@graphics-workbench/core/runtime';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activatedAt = Date.now();
  initializeSafeMode(context);
  initializeControlsPanel(context);
  const outputChannel = vscode.window.createOutputChannel(extensionIdentity.displayName);
  const dependencies = { getConfiguration: getExtensionConfiguration, outputChannel } satisfies CommandDependencies;
  context.subscriptions.push(outputChannel);

  applyRuntimeConfigurationSafely(getExtensionConfiguration, outputChannel);
  void cleanupStaleSecurePdfStagingRoots();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('graphics-workbench.performance.maxConcurrentHeavyProcesses') ||
        event.affectsConfiguration('graphics-workbench.undoHistory.maxRecords') ||
        event.affectsConfiguration('graphics-workbench.externalTools')
      ) {
        applyRuntimeConfigurationSafely(getExtensionConfiguration, outputChannel);
      }
    }),
    new vscode.Disposable(() => {
      sharedHeavyProcessLimiter.stop();
    }),
  );

  registerCommands(context, dependencies);
  registerPreviewCustomEditors(context, dependencies);

  for (const format of insertionFormats) {
    const documentSelector = insertionDocumentSelectors[format];
    context.subscriptions.push(
      vscode.languages.registerDocumentDropEditProvider(documentSelector, new LatexDropEditProvider(format), {
        dropMimeTypes: ['text/uri-list'],
      }),
      vscode.languages.registerDocumentPasteEditProvider(
        documentSelector,
        new LatexPasteEditProvider({ format, getConfiguration: getExtensionConfiguration, outputChannel }),
        {
          providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty],
          pasteMimeTypes: ['image/png', 'image/jpeg'],
        },
      ),
    );
  }

  outputChannel.appendLine(`[activation] extension activated in ${Date.now() - activatedAt}ms`);
}

function applyRuntimeConfigurationSafely(
  getConfiguration: CommandDependencies['getConfiguration'],
  outputChannel: vscode.OutputChannel,
): void {
  try {
    applyRuntimeConfiguration(getConfiguration());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[configuration] ${message}`);
    void vscode.window.showErrorMessage(message);
  }
}
