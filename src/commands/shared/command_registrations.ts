import * as vscode from 'vscode';

import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import { commandBindings, type CommandBinding } from './command_bindings.js';
import type { CommandDependencies } from './command_dependencies.js';

const loadedCommandModules = new Set<string>();

type LoadedCommand = (...args: unknown[]) => Promise<unknown>;

export type CommandResolver = (binding: CommandBinding, outputChannel: LineOutputChannel) => Promise<LoadedCommand>;

function isCommandModule(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoadedCommand(value: unknown): value is LoadedCommand {
  return typeof value === 'function';
}

/** Loads a lazily imported command module and records its first-load duration. */
async function loadCommandModule<T>(
  outputChannel: LineOutputChannel,
  specifier: string,
  load: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const module = await load();

  if (!loadedCommandModules.has(specifier)) {
    loadedCommandModules.add(specifier);
    outputChannel.appendLine(`[load] ${specifier} first load ${Date.now() - startedAt}ms`);
  }

  return module;
}

async function importCommandModule(specifier: string): Promise<unknown> {
  const imported: unknown = await import(specifier);
  return imported;
}

async function resolveCommand(binding: CommandBinding, outputChannel: LineOutputChannel): Promise<LoadedCommand> {
  const imported: unknown = await loadCommandModule(outputChannel, binding.module, async () =>
    importCommandModule(binding.module),
  );
  if (!isCommandModule(imported)) {
    throw new Error(`Command module for ${binding.id} could not be loaded: ${binding.module}`);
  }
  const command = imported[binding.exportName];
  if (!isLoadedCommand(command)) {
    throw new Error(
      `Command binding ${binding.id} refers to missing export ${binding.exportName} in ${binding.module}.`,
    );
  }
  return command;
}

function registerCommand(
  context: vscode.ExtensionContext,
  binding: CommandBinding,
  dependencies: CommandDependencies,
  outputChannel: LineOutputChannel,
  resolve: CommandResolver,
): void {
  switch (binding.adapter) {
    case 'file': {
      context.subscriptions.push(
        vscode.commands.registerCommand(binding.id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
          const command = await resolve(binding, outputChannel);
          return command(uri, uris, dependencies);
        }),
      );
      break;
    }
    case 'fileWithContext': {
      context.subscriptions.push(
        vscode.commands.registerCommand(binding.id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
          const command = await resolve(binding, outputChannel);
          return command(context, uri, uris, dependencies);
        }),
      );
      break;
    }
    case 'fileWithOptions': {
      context.subscriptions.push(
        vscode.commands.registerCommand(binding.id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
          const command = await resolve(binding, outputChannel);
          return command(uri, uris, dependencies, binding.options);
        }),
      );
      break;
    }
    case 'extensionCommand': {
      context.subscriptions.push(
        vscode.commands.registerCommand(binding.id, async (...args: unknown[]) => {
          const command = await resolve(binding, outputChannel);
          return args.length === 0 ? command(undefined, dependencies) : command(...args, dependencies);
        }),
      );
      break;
    }
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
  outputChannel: LineOutputChannel,
): void {
  registerCommandBindings(context, dependencies, outputChannel, resolveCommand);
}

export function registerCommandBindings(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
  outputChannel: LineOutputChannel,
  resolve: CommandResolver,
): void {
  for (const binding of commandBindings) {
    registerCommand(context, binding, dependencies, outputChannel, resolve);
  }
}
