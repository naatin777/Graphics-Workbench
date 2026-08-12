import * as vscode from 'vscode';

import { commandBindings, type CommandBinding } from './command_bindings.js';
import type { CommandDependencies } from './command_dependencies.js';
import { resolveSelectedUris } from './command_input.js';

function registerFileCommand(
  context: vscode.ExtensionContext,
  binding: CommandBinding & { kind: 'file' },
  dependencies: CommandDependencies,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(binding.id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const sourceUris = resolveSelectedUris(uri, uris);
      return binding.handler(sourceUris, dependencies);
    }),
  );
}

function registerFileWithContextCommand(
  context: vscode.ExtensionContext,
  binding: CommandBinding & { kind: 'fileWithContext' },
  dependencies: CommandDependencies,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(binding.id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const sourceUris = resolveSelectedUris(uri, uris);
      return binding.handler(context, sourceUris, dependencies);
    }),
  );
}

function registerExtensionCommand(
  context: vscode.ExtensionContext,
  binding: CommandBinding & { kind: 'extensionCommand' },
  dependencies: CommandDependencies,
): void {
  context.subscriptions.push(
    // oxlint-disable-next-line typescript/no-restricted-types -- VS Codeが渡すコマンド引数は未検証の外部境界。
    vscode.commands.registerCommand(binding.id, async (...args: unknown[]) => {
      return binding.handler(dependencies, ...args);
    }),
  );
}

export function registerCommands(context: vscode.ExtensionContext, dependencies: CommandDependencies): void {
  for (const binding of commandBindings) {
    switch (binding.kind) {
      case 'file': {
        registerFileCommand(context, binding, dependencies);
        break;
      }
      case 'fileWithContext': {
        registerFileWithContextCommand(context, binding, dependencies);
        break;
      }
      case 'extensionCommand': {
        registerExtensionCommand(context, binding, dependencies);
        break;
      }
    }
  }
}
