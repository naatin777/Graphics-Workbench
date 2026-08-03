import assert from 'node:assert/strict';

import {
  getLargeOperationWarningReasons,
  type LargeOperationWarningSettings,
} from '../../src/config/large_operation_warnings.js';

const defaultSettings: LargeOperationWarningSettings = {
  enabled: true,
  pdfPages: 1000,
  inputSizeMiB: 500,
};

suite('大規模処理警告の判定', () => {
  test('閾値未満では理由を返さない', () => {
    assert.deepStrictEqual(
      getLargeOperationWarningReasons(defaultSettings, {
        totalBytes: 499 * 1024 * 1024,
        pdfPageCount: 999,
      }),
      {},
    );
  });

  test('ページ数と入力容量の超過を1回分の理由へまとめる', () => {
    assert.deepStrictEqual(
      getLargeOperationWarningReasons(defaultSettings, {
        totalBytes: 600 * 1024 * 1024,
        pdfPageCount: 1200,
      }),
      { pdfPageCount: 1200, inputSizeMiB: 600 },
    );
  });

  test('enabledや閾値0は呼び出し側で表示を無効化できる', () => {
    assert.deepStrictEqual(
      getLargeOperationWarningReasons(
        { enabled: false, pdfPages: 0, inputSizeMiB: 0 },
        { totalBytes: 1024 * 1024 * 1024, pdfPageCount: 10_000 },
      ),
      {},
    );
    assert.deepStrictEqual(
      getLargeOperationWarningReasons(
        { ...defaultSettings, pdfPages: 0, inputSizeMiB: 0 },
        {
          totalBytes: 1024 * 1024 * 1024,
          pdfPageCount: 10_000,
        },
      ),
      {},
    );
  });
});
