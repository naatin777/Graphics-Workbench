// Test target:
// - Safe Mode ON時のダイアログ選択結果を競合判断へ変換すること
// - Safe Mode OFF時はダイアログを表示せずoverwriteを返すこと
// - 複数競合時もダイアログを1回だけ表示し、競合件数を文言へ渡すこと
//
// Mocked:
// - vscode.window.showWarningMessageの戻り値
// - ExtensionContext.globalState相当のkey-value storage
//
// Not tested:
// - ダイアログが画面上で正しく描画されること
// - ボタンの配置や外観
// - ファイルの実際の反映処理

import assert from 'node:assert/strict';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { initializeSafeMode, resolveOutputConflicts } from '../../../src/commands/lifecycle/safe_mode.js';

suite('Safe Mode有効時に競合ダイアログの選択結果から上書き判断を返す処理', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: MemoryState;
  let showWarningMessageStub: sinon.SinonStub;

  setup(() => {
    sandbox = createSandbox();
    storage = new MemoryState();
    showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
    initializeSafeMode(createExtensionContext(storage));
  });

  teardown(() => {
    sandbox.restore();
  });

  test('出力先に競合する既存ファイルがあるとき、ダイアログでKeep Bothを選択すると両方残す判断を返す', async () => {
    showWarningMessageStub.resolves({ title: 'Keep Both' });

    assert.strictEqual(await resolveOutputConflicts(['/workspace/sample.pdf']), 'keep-both');
  });

  test('競合ダイアログでDo Not Overwriteを選択すると上書きしない判断を返す', async () => {
    showWarningMessageStub.resolves({ title: 'Do Not Overwrite' });

    assert.strictEqual(await resolveOutputConflicts(['/workspace/sample.pdf']), 'cancel');
  });

  test('競合ダイアログでOverwriteを選択すると上書きする判断を返す', async () => {
    showWarningMessageStub.resolves({ title: 'Overwrite' });

    assert.strictEqual(await resolveOutputConflicts(['/workspace/sample.pdf']), 'overwrite');
  });

  test('競合ダイアログを選択せず閉じた場合は何も実行しない判断を返す', async () => {
    showWarningMessageStub.resolves(undefined);

    assert.strictEqual(await resolveOutputConflicts(['/workspace/sample.pdf']), 'cancel');
  });

  test('ダイアログにはKeep Both・Do Not Overwrite・Overwriteの3項目だけを渡し、Do Not Overwriteを閉じる操作として扱い、単独のCancel項目は渡さない', async () => {
    showWarningMessageStub.resolves({ title: 'Do Not Overwrite' });

    await resolveOutputConflicts(['/workspace/sample.pdf']);

    const items = showWarningMessageStub.firstCall.args.slice(2).filter(isMessageItem);
    assert.deepStrictEqual(
      items.map((item) => item.title),
      ['Keep Both', 'Do Not Overwrite', 'Overwrite'],
    );
    assert.strictEqual(items.find((item) => item.title === 'Do Not Overwrite')?.isCloseAffordance, true);
    assert.strictEqual(
      items.some((item) => item.title === 'Cancel'),
      false,
    );
  });

  test('Safe Modeが無効（globalStateでOFF）の場合は競合ダイアログを表示せず、そのまま上書きする判断を返す', async () => {
    await storage.update('safeMode.enabled', false);
    initializeSafeMode(createExtensionContext(storage));

    assert.strictEqual(await resolveOutputConflicts(['/workspace/sample.pdf']), 'overwrite');
    assert.strictEqual(showWarningMessageStub.callCount, 0);
  });

  test('3つの出力ファイルが競合する場合でもダイアログは1回だけ表示し、競合件数3を含む文言を出して上書きする判断を返す', async () => {
    showWarningMessageStub.resolves({ title: 'Overwrite' });

    assert.strictEqual(
      await resolveOutputConflicts(['/workspace/one.pdf', '/workspace/two.pdf', '/workspace/three.pdf']),
      'overwrite',
    );

    assert.strictEqual(showWarningMessageStub.callCount, 1);
    assert.strictEqual(showWarningMessageStub.firstCall.args[0], '3 output file(s) already exist.');
  });
});

function createExtensionContext(globalState: MemoryState): Parameters<typeof initializeSafeMode>[0] {
  return {
    globalState,
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

function isMessageItem(value: unknown): value is vscode.MessageItem {
  return typeof value === 'object' && value !== null && 'title' in value && typeof value.title === 'string';
}
