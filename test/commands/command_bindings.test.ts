// Test target:
// - manifestのpublic command集合とbinding集合が完全一致すること
// - bindingのcommand IDに重複がないこと
// - 各bindingのmodule/export名が実在すること
// - registerCommandBindingsがbinding集合と正確に一致するcommandだけを登録すること
// - adapterごとに正しい引数が渡されること（file / fileWithContext / fileWithOptions / extensionCommand）
// - fileWithContextがExtensionContextを渡すこと
// - fixed optionsがWebP/GIF commandへ渡されること
// - 同じmoduleを共有するcommandのfirst load計測が重複しないこと
// - resolverの例外がhandlerから伝播すること
//
// Mocked:
// - vscode.commands.registerCommand
//
// Not tested:
// - 実ファイル変換の挙動（各command testが担当）

import assert from 'node:assert/strict';
import path from 'node:path';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { commandBindings } from '../../src/commands/shared/command_bindings.js';
import {
  registerCommandBindings,
  registerCommands,
  type CommandResolver,
} from '../../src/commands/shared/command_registrations.js';
import type { CommandDependencies } from '../../src/commands/shared/command_dependencies.js';
import { publicCommandIds } from '../../src/generated/extension_manifest.js';
import { RecordingOutputChannel } from '../helpers/recording_output_channel.js';

const LEGACY_PNG_TO_PDF_COMMAND = 'graphics-workbench.convertPngToPdf';

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>;
type RecordedCall = { bindingId: string; args: unknown[] };

suite('command bindingの整合性', () => {
  test('binding集合とmanifestのpublic command集合が完全一致する', () => {
    const bindingIds = commandBindings.map((binding) => binding.id);

    assert.strictEqual(bindingIds.length, publicCommandIds.length);
    assert.deepStrictEqual(new Set(bindingIds), new Set(publicCommandIds));
  });

  test('bindingのcommand IDに重複がない', () => {
    const bindingIds = commandBindings.map((binding) => binding.id);

    assert.strictEqual(new Set(bindingIds).size, bindingIds.length);
  });

  test('各bindingのmoduleとexport名が実在する', async () => {
    for (const binding of commandBindings) {
      const module = await import(bindingModuleSpecifier(binding));
      assert.strictEqual(
        typeof module[binding.exportName],
        'function',
        `${binding.id} should export ${binding.exportName} from ${binding.module}`,
      );
    }
  });
});

suite('command registration', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('bindingに定義されたcommandだけを登録し、manifest外の旧commandは登録しない', () => {
    const handlers = captureRegisteredHandlers(sandbox);

    registerCommandBindings(createContext(), {}, new RecordingOutputChannel(), noopResolver);

    assert.deepStrictEqual(new Set(handlers.keys()), new Set(commandBindings.map((binding) => binding.id)));
    assert.ok(!handlers.has(LEGACY_PNG_TO_PDF_COMMAND), `${LEGACY_PNG_TO_PDF_COMMAND} must not be registered`);
  });

  test('file adapterはuri、uris、dependenciesを渡す', async () => {
    const calls = recordingCalls();
    const dependencies: CommandDependencies = {};
    const uri = vscode.Uri.file('/workspace/source.pdf');
    const uris = [uri];

    await invokeBoundCommand(
      sandbox,
      'graphics-workbench.compressPdf',
      dependencies,
      calls.resolver,
      createContext(),
      uri,
      uris,
    );

    assert.deepStrictEqual(calls.recorded, [
      { bindingId: 'graphics-workbench.compressPdf', args: [uri, uris, dependencies] },
    ]);
  });

  test('fileWithContext adapterはExtensionContextを先頭に渡す', async () => {
    const calls = recordingCalls();
    const dependencies: CommandDependencies = {};
    const context = createContext();
    const uri = vscode.Uri.file('/workspace/source.pdf');

    await invokeBoundCommand(
      sandbox,
      'graphics-workbench.cropPdf.configure',
      dependencies,
      calls.resolver,
      context,
      uri,
    );

    assert.deepStrictEqual(calls.recorded, [
      { bindingId: 'graphics-workbench.cropPdf.configure', args: [context, uri, undefined, dependencies] },
    ]);
  });

  test('fileWithOptions adapterは固定optionsを最後の引数として渡す', async () => {
    const calls = recordingCalls();
    const dependencies: CommandDependencies = {};
    const uri = vscode.Uri.file('/workspace/source.gif');

    await invokeBoundCommand(
      sandbox,
      'graphics-workbench.convertToWebpPreserveAnimation',
      dependencies,
      calls.resolver,
      createContext(),
      uri,
    );

    assert.deepStrictEqual(calls.recorded, [
      {
        bindingId: 'graphics-workbench.convertToWebpPreserveAnimation',
        args: [uri, undefined, dependencies, { outputMode: 'preserve' }],
      },
    ]);
  });

  test('extensionCommand adapterは任意の引数とdependenciesを渡す', async () => {
    const calls = recordingCalls();
    const dependencies: CommandDependencies = {};

    await invokeBoundCommand(
      sandbox,
      'graphics-workbench.undoLastConversion',
      dependencies,
      calls.resolver,
      createContext(),
      'expected-id',
    );

    assert.deepStrictEqual(calls.recorded, [
      { bindingId: 'graphics-workbench.undoLastConversion', args: ['expected-id', dependencies] },
    ]);
  });

  test('extensionCommand adapterは引数なしでもdependenciesを第二引数として渡す', async () => {
    const calls = recordingCalls();
    const dependencies: CommandDependencies = {};

    await invokeBoundCommand(
      sandbox,
      'graphics-workbench.undoLastConversion',
      dependencies,
      calls.resolver,
      createContext(),
    );

    assert.deepStrictEqual(calls.recorded, [
      { bindingId: 'graphics-workbench.undoLastConversion', args: [undefined, dependencies] },
    ]);
  });

  test('resolverの例外がhandlerから伝播し隠蔽されない', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const throwingResolver: CommandResolver = async () => {
      throw new Error('command resolution failed');
    };

    registerCommandBindings(createContext(), {}, new RecordingOutputChannel(), throwingResolver);

    await assert.rejects(handlers.get('graphics-workbench.compressPdf')!(), /command resolution failed/);
  });

  test('同じmoduleを共有するcommandのfirst load計測は1回だけ記録される', async () => {
    const outputChannel = new RecordingOutputChannel();
    const handlers = captureRegisteredHandlers(sandbox);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

    registerCommands(createContext(), {}, outputChannel);

    await handlers.get('graphics-workbench.convertToWebp')!();
    await handlers.get('graphics-workbench.convertToWebpPreserveAnimation')!();

    const loadLines = outputChannel.lines.filter((line) =>
      line.includes('../conversion/convert_to_raster.js first load'),
    );
    assert.strictEqual(loadLines.length, 1);
  });
});

function createContext(): vscode.ExtensionContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal ExtensionContext stub; registration only uses subscriptions.
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function bindingModuleSpecifier(binding: { module: string }): string {
  return path.posix.join('../../src/commands/shared', binding.module);
}

function captureRegisteredHandlers(sandbox: sinon.SinonSandbox): Map<string, RegisteredHandler> {
  const handlers = new Map<string, RegisteredHandler>();
  sandbox.stub(vscode.commands, 'registerCommand').callsFake((id: string, callback: RegisteredHandler) => {
    handlers.set(id, callback);
    return new FakeDisposable();
  });
  return handlers;
}

const noopResolver: CommandResolver = async () => async () => {};

function recordingCalls(): { recorded: RecordedCall[]; resolver: CommandResolver } {
  const recorded: RecordedCall[] = [];
  const resolver: CommandResolver = async (binding) => {
    return async (...args: unknown[]) => {
      recorded.push({ bindingId: binding.id, args });
    };
  };
  return { recorded, resolver };
}

async function invokeBoundCommand(
  sandbox: sinon.SinonSandbox,
  bindingId: string,
  dependencies: CommandDependencies,
  resolver: CommandResolver,
  context: vscode.ExtensionContext,
  ...args: unknown[]
): Promise<void> {
  const handlers = captureRegisteredHandlers(sandbox);
  registerCommandBindings(context, dependencies, new RecordingOutputChannel(), resolver);
  await handlers.get(bindingId)!(...args);
}

class FakeDisposable {
  dispose(): void {}
}
