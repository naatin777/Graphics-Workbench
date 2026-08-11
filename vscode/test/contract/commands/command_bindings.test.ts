// Test target:
// - manifestのpublic command集合とbinding集合が完全一致すること
// - bindingのcommand IDに重複がないこと
// - registerCommandsがbinding集合と正確に一致するcommandだけを登録すること
// - kindごとに正しい引数へ変換・呼び出しされること（file / fileWithContext / extensionCommand）
// - fileがVS Codeの(uri, uris)入力をsourceUris[]へ正規化して渡すこと
//
// Mocked:
// - vscode.commands.registerCommand
// - 各ハンドラの呼び出し（ESM importのためstub不可 → binding構造と登録コールバックの引数変換を検証）
//
// Not tested:
// - 実ファイル変換の挙動（各command testが担当）

import assert from 'node:assert/strict';

import { createSandbox, type SinonSandbox } from 'sinon';
import * as vscode from 'vscode';

import { commandBindings, type CommandBinding } from '../../../src/commands/shared/command_bindings.js';
import { registerCommands } from '../../../src/commands/shared/command_registrations.js';
import { publicCommandIds } from '../../../src/generated/extension_manifest.js';
import { testCommandDependencies } from '../../support/helpers/command_dependencies.js';

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>;

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
});

suite('command登録処理', () => {
  let sandbox: SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test('bindingに定義されたcommandだけを登録する', () => {
    const handlers = captureRegisteredHandlers(sandbox);

    registerCommands(createContext(), testCommandDependencies());

    assert.deepStrictEqual(new Set(handlers.keys()), new Set(commandBindings.map((binding) => binding.id)));
  });

  test('file bindingのhandlerがsourceUrisとdependenciesを正しい順で受ける', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const uri = vscode.Uri.file('/workspace/source.pdf');
    const uris = [uri];

    const binding = findBinding('graphics-workbench.compressPdf');
    assert.strictEqual(binding.kind, 'file');
    const called = captureHandlerCalls(sandbox, binding);
    registerCommands(createContext(), dependencies);

    await handlers.get(binding.id)!(uri, uris);

    assert.deepStrictEqual(called.calls, [[[uri], dependencies, undefined]]);
  });

  test('fileWithContext bindingのhandlerがExtensionContext、sourceUris、dependenciesを正しい順で受ける', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const context = createContext();
    const uri = vscode.Uri.file('/workspace/source.pdf');

    const binding = findBinding('graphics-workbench.cropPdf.configure');
    assert.strictEqual(binding.kind, 'fileWithContext');
    const called = captureHandlerCalls(sandbox, binding);
    registerCommands(context, dependencies);

    await handlers.get(binding.id)!(uri, [uri]);

    assert.deepStrictEqual(called.calls, [[context, [uri], dependencies]]);
  });

  test('ラスタ変換bindingが固定optionsをhandlerへ渡す', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const uri = vscode.Uri.file('/workspace/source.gif');

    const binding = findBinding('graphics-workbench.convertToWebpPreserveAnimation');
    assert.strictEqual(binding.kind, 'file');
    assert.deepStrictEqual(binding.options, { target: 'webp' });
    const called = captureHandlerCalls(sandbox, binding);
    registerCommands(createContext(), dependencies);

    await handlers.get(binding.id)!(uri);

    assert.strictEqual(called.calls.length, 1);
    assert.deepStrictEqual(called.calls[0], [[uri], dependencies, { target: 'webp' }]);
  });

  test('フレーム分割bindingがfixedオプションとしてcardinality:splitをhandlerへ渡す', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();
    const uri = vscode.Uri.file('/workspace/source.gif');

    const binding = findBinding('graphics-workbench.convertToWebpSeparately');
    assert.strictEqual(binding.kind, 'file');
    assert.deepStrictEqual(binding.options, { target: 'webp', cardinality: 'split' });
    const called = captureHandlerCalls(sandbox, binding);
    registerCommands(createContext(), dependencies);

    await handlers.get(binding.id)!(uri);

    assert.strictEqual(called.calls.length, 1);
    assert.deepStrictEqual(called.calls[0], [[uri], dependencies, { target: 'webp', cardinality: 'split' }]);
  });

  test('extensionCommand bindingのhandlerがVS Codeから渡された任意引数とdependenciesを正しい順で受ける', async () => {
    const handlers = captureRegisteredHandlers(sandbox);
    const dependencies = testCommandDependencies();

    const binding = findBinding('graphics-workbench.undoLastConversion');
    assert.strictEqual(binding.kind, 'extensionCommand');
    const called = captureHandlerCalls(sandbox, binding);
    registerCommands(createContext(), dependencies);

    await handlers.get(binding.id)!('undo-record-id');

    assert.deepStrictEqual(called.calls, [[dependencies, 'undo-record-id']]);
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

function findBinding(id: string): CommandBinding {
  const binding = commandBindings.find((candidate) => candidate.id === id);
  assert.ok(binding, `binding ${id} should exist`);
  return binding;
}

function captureHandlerCalls(sandbox: SinonSandbox, binding: CommandBinding): { calls: unknown[][] } {
  const calls: unknown[][] = [];
  // 引数変換の検証のため、実ハンドラの代わりに呼び出しを捕捉する（ESM関数はstub不可のため）。
  sandbox.stub(binding, 'handler').callsFake(async (...args: unknown[]): Promise<void> => {
    calls.push(args);
  });
  return { calls };
}

class FakeDisposable {
  dispose(): void {}
}
