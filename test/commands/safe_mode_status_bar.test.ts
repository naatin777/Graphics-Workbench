// Test target:
// - Safe Mode初期化時にstatus bar itemを作成すること
// - status bar itemのtext、command、tooltip、show()呼び出しが設定されること
// - toggleSafeModeCommand実行時に状態とstatus bar textが更新されること
// - globalStateに保存済みの状態からstatus bar textを復元すること
// - ExtensionContext.subscriptionsへstatus bar itemを登録すること
//
// Mocked:
// - vscode.window.createStatusBarItem
// - ExtensionContext.globalState相当のkey-value storage
//
// Not tested:
// - 実際のVS Code画面上のstatus bar描画
// - status bar itemの表示位置
// - ダイアログの画面上の外観
// - VS Code再起動そのもの
// - crop、split、PNG変換の実ファイル処理

import assert from 'node:assert/strict';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { initializeSafeMode, toggleSafeModeCommand } from '../../src/commands/lifecycle/safe_mode.js';

suite('Safe Modeのstatus bar項目の作成・表示文言・toggle連動・状態復元', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: MemoryState;
  let statusBarItem: FakeStatusBarItem;
  let subscriptions: vscode.Disposable[];

  setup(() => {
    sandbox = createSandbox();
    storage = new MemoryState();
    statusBarItem = new FakeStatusBarItem();
    subscriptions = [];

    sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('初期状態ではSafe Mode ONを示す文言・toggleコマンド・tooltipを持つstatus bar項目を作成して1回表示する', () => {
    initializeSafeMode(createExtensionContext(storage, subscriptions));

    assert.strictEqual(statusBarItem.text, '$(shield) Safe Mode: ON');
    assert.strictEqual(statusBarItem.command, 'graphics-workbench.toggleSafeMode');
    assert.strictEqual(statusBarItem.tooltip, 'Toggle Safe Mode');
    assert.strictEqual(statusBarItem.showCallCount, 1);
  });

  test('toggleコマンドを実行するたびにstatus barの表示文言をON/OFFで切り替え、その状態をglobalStateへ保存する', async () => {
    initializeSafeMode(createExtensionContext(storage, subscriptions));

    await toggleSafeModeCommand();

    assert.strictEqual(statusBarItem.text, '$(shield) Safe Mode: OFF');
    assert.strictEqual(storage.get('safeMode.enabled'), false);

    await toggleSafeModeCommand();

    assert.strictEqual(statusBarItem.text, '$(shield) Safe Mode: ON');
    assert.strictEqual(storage.get('safeMode.enabled'), true);
  });

  test('globalStateに保存済みのSafe Mode OFF状態を初期化時に読み取り、status barにOFF表示を復元する', async () => {
    await storage.update('safeMode.enabled', false);

    initializeSafeMode(createExtensionContext(storage, subscriptions));

    assert.strictEqual(statusBarItem.text, '$(shield) Safe Mode: OFF');
  });

  test('初期化時に作成したstatus bar項目をExtensionContextのsubscriptionsへ登録して破棄対象にする', () => {
    initializeSafeMode(createExtensionContext(storage, subscriptions));

    assert.strictEqual(subscriptions.length, 1);
    assert.strictEqual(subscriptions[0], statusBarItem);
  });
});

function createExtensionContext(
  globalState: MemoryState,
  subscriptions: vscode.Disposable[] = [],
): Parameters<typeof initializeSafeMode>[0] {
  return {
    globalState,
    subscriptions,
  };
}

class MemoryState {
  readonly #values = new Map<string, unknown>();

  get(key: 'safeMode.enabled', defaultValue?: boolean): boolean | undefined {
    const value = this.#values.get(key);
    return typeof value === 'boolean' ? value : defaultValue;
  }

  async update(key: 'safeMode.enabled', value: boolean): Promise<void> {
    this.#values.set(key, value);
  }
}

class FakeStatusBarItem implements vscode.StatusBarItem {
  readonly id = 'test.safe-mode';
  readonly alignment = vscode.StatusBarAlignment.Right;
  readonly priority = 100;
  name = 'Test Safe Mode';
  command: string | undefined;
  text = '';
  tooltip: vscode.StatusBarItem['tooltip'] = undefined;
  color: vscode.StatusBarItem['color'] = undefined;
  backgroundColor: vscode.StatusBarItem['backgroundColor'] = undefined;
  accessibilityInformation: vscode.StatusBarItem['accessibilityInformation'] = undefined;
  showCallCount = 0;

  show(): void {
    this.showCallCount += 1;
  }

  hide(): void {}

  dispose(): void {}
}
