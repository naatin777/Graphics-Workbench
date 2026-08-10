// Test target:
// - manifestのpublic command集合とbinding集合が完全一致すること
// - bindingのcommand IDに重複がないこと
// - 各bindingのmodule/export名が実在すること
// - registerCommandBindingsがbinding集合と正確に一致するcommandだけを登録すること
// - adapterごとに正しい引数が渡されること（file / fileWithContext / extensionCommand）
// - file adapterがVS Codeの(uri, uris)入力をsourceUris[]へ正規化して渡すこと
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
import { testCommandDependencies } from '../helpers/command_dependencies.js';
import { RecordingOutputChannel } from '../helpers/recording_output_channel.js';

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>;
type RecordedCall = { bindingId: string; args: unknown[] };

suite('command binding集合とmanifestの整合性検証', () => {
  test('binding集合のidとmanifestのpublic command集合のidが数・内容とも完全一致する', () => {
    const bindingIds = commandBindings.map((binding) => binding.id);

    assert.strictEqual(bindingIds.length, publicCommandIds.length);
    assert.deepStrictEqual(new Set(bindingIds), new Set(publicCommandIds));
  });

  test('全bindingのcommand IDに重複がなく一意である', () => {
    const bindingIds = commandBindings.map((binding) => binding.id);

    assert.strictEqual(new Set(bindingIds).size, bindingIds.length);
  });

  test('各bindingのmoduleをimportすると指定されたexport名の関数が実在する', async () => {
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

suite('command登録処理', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('bindingに定義されたcommandだけを登録する', () => {
    const handlers = captureRegisteredHandlers(sandbox);

    registerCommandBindings(createContext(), testCommandDependencies(), new RecordingOutputChannel(), noopResolver);

    assert.deepStrictEqual(new Set(handlers.keys()), new Set(commandBindings.map((binding) => binding.id)));
  });

  test('file adapterでcompressPdfを実行するとhandlerへ正規化したsourceUris、dependenciesをこの順で渡す', async () => {
    const calls = recordingCalls();
    const dependencies = testCommandDependencies();
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
      { bindingId: 'graphics-workbench.compressPdf', args: [[uri], dependencies, undefined] },
    ]);
  });

  test('fileWithContext adapterでcropPdf.configureを実行するとhandlerへExtensionContextを先頭に正規化したsourceUris、dependenciesを渡す', async () => {
    const calls = recordingCalls();
    const dependencies = testCommandDependencies();
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
      { bindingId: 'graphics-workbench.cropPdf.configure', args: [context, [uri], dependencies] },
    ]);
  });

  test('file adapter（options付き）でconvertToWebpPreserveAnimationを実行するとhandlerへ正規化したsourceUris、dependencies、固定optionsの順で渡す', async () => {
    const calls = recordingCalls();
    const dependencies = testCommandDependencies();
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
        args: [[uri], dependencies, { target: 'webp', outputMode: 'preserve' }],
      },
    ]);
  });

  test('extensionCommand adapterでundoLastConversionへ文字列expected-idを渡すと、handlerへその引数とdependenciesをこの順で渡す', async () => {
    const calls = recordingCalls();
    const dependencies = testCommandDependencies();

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

  test('extensionCommand adapterで引数なしでundoLastConversionを実行するとhandlerへundefinedとdependenciesを渡す', async () => {
    const calls = recordingCalls();
    const dependencies = testCommandDependencies();

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

  test('command resolverが例外を投げた場合、handlerの呼び出しが"command resolution failed"エラーでrejectされ伝播する', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const throwingResolver: CommandResolver = async () => {
      throw new Error('command resolution failed');
    };

    registerCommandBindings(createContext(), testCommandDependencies(), new RecordingOutputChannel(), throwingResolver);

    await assert.rejects(handlers.get('graphics-workbench.compressPdf')!(), /command resolution failed/);
  });

  test('convertToWebpとconvertToWebpPreserveAnimationを実行しても共通moduleのfirst load計測がoutput channelへ1回だけ記録される', async () => {
    const outputChannel = new RecordingOutputChannel();
    const handlers = captureRegisteredHandlers(sandbox);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

    registerCommands(createContext(), testCommandDependencies(), outputChannel);

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
