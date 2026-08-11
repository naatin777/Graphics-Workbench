// Test target:
// - Safe Modeが初期値ONで、切替状態をglobal storageへ保存すること
//
// Mocked:
// - ExtensionContext.globalState相当のkey-value storage
//
// Not tested:
// - VS Codeのstatus bar描画
// - command登録

import assert from 'node:assert/strict';

import { SafeModeState } from '../../../src/commands/lifecycle/safe_mode.js';

suite('Safe Mode状態', () => {
  test('保存済み状態が無い初期状態ではSafe Modeが有効（ON）である', () => {
    const state = new SafeModeState(new MemoryState());

    assert.strictEqual(state.isEnabled(), true);
  });

  test('toggleでOFFに切り替えるとglobalStateへfalseを保存し、別インスタンスで読み直してもOFFを復元し、再度toggleするとtrueが保存される', async () => {
    const storage = new MemoryState();
    const state = new SafeModeState(storage);

    assert.strictEqual(await state.toggle(), false);
    assert.strictEqual(storage.get('safeMode.enabled'), false);
    assert.strictEqual(new SafeModeState(storage).isEnabled(), false);
    assert.strictEqual(await state.toggle(), true);
    assert.strictEqual(storage.get('safeMode.enabled'), true);
  });
});

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
