// Test target:
// - manifestのpublic command集合とregisterCommandsの登録集合が完全一致すること
// - 登録されるcommand IDに重複がないこと
// - helperごとに正しい引数へ変換・呼び出しされること（file / fileWithContext / extensionCommand / raster）
// - fileがVS Codeの(uri, uris)入力をsourceUris[]へ正規化して渡すこと
//
// Mocked:
// - vscode.commands.registerCommand
// - helperへ渡すhandlerの呼び出し
//
// Not tested:
// - 実ファイル変換の挙動（各command testが担当）

import assert from 'node:assert/strict';

import { createSandbox, type SinonSandbox } from 'sinon';
import * as vscode from 'vscode';

import {
  registerCommands,
  registerExtensionCommand,
  registerFileCommand,
  registerFileWithContextCommand,
  registerRasterCommand,
} from '../../../src/commands/shared/command_registrations.js';
import { publicCommandIds } from '../../../src/generated/extension_manifest.js';
import { testCommandDependencies } from '../../support/helpers/command_dependencies.js';

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>;

suite('command登録集合とmanifestの整合性検証', () => {
  let sandbox: SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('registerCommandsがmanifestのpublic command集合と数・内容とも完全一致するcommandだけを登録する', () => {
    const handlers = captureRegisteredHandlers(sandbox);

    registerCommands(createContext(), testCommandDependencies());

    assert.strictEqual(handlers.size, publicCommandIds.length);
    assert.deepStrictEqual(new Set(handlers.keys()), new Set(publicCommandIds));
  });
});

suite('command登録helperの引数変換', () => {
  let sandbox: SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('registerFileCommandは(uri, uris)をsourceUrisへ正規化し、sourceUrisとdependenciesを渡す', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const context = createContext();
    const uri = vscode.Uri.file('/workspace/source.pdf');
    const calls: unknown[][] = [];
    registerFileCommand(
      context,
      'graphics-workbench.compressPdf',
      async (...args: unknown[]): Promise<void> => {
        calls.push(args);
      },
      dependencies,
    );

    await handlers.get('graphics-workbench.compressPdf')!(uri, [uri]);

    assert.deepStrictEqual(calls, [[[uri], dependencies]]);
  });

  test('registerFileWithContextCommandはExtensionContext、sourceUris、dependenciesの順で渡す', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const context = createContext();
    const uri = vscode.Uri.file('/workspace/source.pdf');
    const calls: unknown[][] = [];
    registerFileWithContextCommand(
      context,
      'graphics-workbench.cropPdf.configure',
      async (...args: unknown[]): Promise<void> => {
        calls.push(args);
      },
      dependencies,
    );

    await handlers.get('graphics-workbench.cropPdf.configure')!(uri, [uri]);

    assert.deepStrictEqual(calls, [[context, [uri], dependencies]]);
  });

  test('registerRasterCommandはraster変換をoptions付きのfile handlerとして登録し、引数なし呼び出しではエラー通知を出して完了する', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const context = createContext();
    registerRasterCommand(context, 'graphics-workbench.convertToWebp', { target: 'webp' }, dependencies);

    assert.ok(handlers.has('graphics-workbench.convertToWebp'));
    const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    await handlers.get('graphics-workbench.convertToWebp')!();
    assert.strictEqual(showErrorMessage.callCount, 1);
    const message = showErrorMessage.firstCall.args[0];
    assert.ok(typeof message === 'string' && message.includes('No files were selected.'));
  });

  test('registerExtensionCommandはVS Codeから渡された任意引数をdependenciesの後に渡す', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const context = createContext();
    const calls: unknown[][] = [];
    registerExtensionCommand(
      context,
      'graphics-workbench.undoLastConversion',
      async (...args: unknown[]): Promise<void> => {
        calls.push(args);
      },
      dependencies,
    );

    await handlers.get('graphics-workbench.undoLastConversion')!('undo-record-id');

    assert.deepStrictEqual(calls, [[dependencies, 'undo-record-id']]);
  });
});

function createContext(): vscode.ExtensionContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal ExtensionContext stub; registration only uses subscriptions.
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function captureRegisteredHandlers(sandbox: SinonSandbox): Map<string, RegisteredHandler> {
  const handlers = new Map<string, RegisteredHandler>();
  sandbox.stub(vscode.commands, 'registerCommand').callsFake((id: string, callback: RegisteredHandler) => {
    handlers.set(id, callback);
    return new FakeDisposable();
  });
  return handlers;
}

class FakeDisposable {
  dispose(): void {}
}
