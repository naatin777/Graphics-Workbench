import * as vscode from 'vscode';

import { registerCommands } from './commands/shared/command_registrations.js';
import type { CommandDependencies } from './commands/shared/command_dependencies.js';
import { initializeSafeMode } from './commands/lifecycle/safe_mode.js';
import { initializeUndoHistory } from './commands/lifecycle/undo_last_conversion.js';
import { cleanupStaleSecurePdfStagingRoots } from './operations/lifecycle/secure_staging.js';
import { LatexDropEditProvider } from './edit_provider/latex_drop_edit_provider.js';
import { LatexPasteEditProvider } from './edit_provider/latex_paste_edit_provider.js';
import { getExtensionConfiguration } from './config/extension_configuration.js';
import { configureExternalToolTimeouts } from './config/external_tools/external_tool_settings.js';
import { getMaxConcurrentHeavyProcesses } from './config/performance.js';
import {
  sharedConversionJobLimiter,
  sharedHeavyProcessLimiter,
} from './operations/external_tools/heavy_process_limiter.js';

const latexDocumentSelector: vscode.DocumentSelector = [{ language: 'latex' }, { language: 'tex' }];

function configureHeavyProcessRuntime(): void {
  const configuration = getExtensionConfiguration();
  configureExternalToolTimeouts(configuration);
  const concurrency = getMaxConcurrentHeavyProcesses(configuration);
  sharedHeavyProcessLimiter.setConcurrency(concurrency);
  sharedConversionJobLimiter.setConcurrency(concurrency);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activatedAt = Date.now();
  await cleanupStaleSecurePdfStagingRoots();
  initializeSafeMode(context);
  const outputChannel = vscode.window.createOutputChannel('Graphics Workbench');
  initializeUndoHistory({ workspaceState: context.workspaceState, outputChannel });
  const dependencies = { getConfiguration: getExtensionConfiguration, outputChannel } satisfies CommandDependencies;
  context.subscriptions.push(outputChannel);

  configureHeavyProcessRuntime();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('graphics-workbench.performance.maxConcurrentHeavyProcesses') ||
        event.affectsConfiguration('graphics-workbench.externalTools')
      ) {
        configureHeavyProcessRuntime();
      }
    }),
    new vscode.Disposable(() => {
      sharedHeavyProcessLimiter.stop();
      sharedConversionJobLimiter.stop();
    }),
  );

  registerCommands(context, dependencies, outputChannel);
  context.subscriptions.push(
    vscode.languages.registerDocumentDropEditProvider(latexDocumentSelector, new LatexDropEditProvider(), {
      dropMimeTypes: ['text/uri-list'],
    }),
    vscode.languages.registerDocumentPasteEditProvider(
      latexDocumentSelector,
      new LatexPasteEditProvider({ getConfiguration: getExtensionConfiguration, outputChannel }),
      {
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty],
        pasteMimeTypes: ['image/png', 'image/jpeg'],
      },
    ),
  );

  outputChannel.appendLine(`[activation] extension activated in ${Date.now() - activatedAt}ms`);
}
