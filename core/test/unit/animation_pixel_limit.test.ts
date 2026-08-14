import assert from 'node:assert/strict';

import { assertAnimationPixelLimit } from '@graphics-workbench/core/conversion';

describe('アニメーションpixel上限invariant（core所有）', () => {
  it('合計pixel（width×pageHeight×frameCount）が上限内なら通過し、超過時はBigIntで総計を検査して例外を投げる', () => {
    assert.doesNotThrow(() => assertAnimationPixelLimit(10_000_000, 10_000_000, 1, 100_000_000_000_000, 'image.gif'));
    assert.throws(
      () => assertAnimationPixelLimit(10_000_000, 10_000_000, 2, 100_000_000_000_000, 'image.gif'),
      /exceeds the configured total animation pixel limit/iu,
    );
  });

  it('寸法が0または非整数の場合は上限判定へ進まず、safe dimensionsの例外を投げる', () => {
    assert.throws(
      () => assertAnimationPixelLimit(0, 100, 2, 500, 'image.gif'),
      /Could not determine safe animation dimensions/iu,
    );
    assert.throws(
      () => assertAnimationPixelLimit(1.5, 100, 2, 500, 'image.gif'),
      /Could not determine safe animation dimensions/iu,
    );
    assert.throws(
      () => assertAnimationPixelLimit(10, 100, 0, 500, 'image.gif'),
      /Could not determine safe animation dimensions/iu,
    );
  });

  it('上限超過エラーは入力パス・設定値・合計pixelを報告する', () => {
    assert.throws(() => assertAnimationPixelLimit(100, 100, 4, 10_000, 'reports/tall.gif'), /reports\/tall\.gif/iu);
    assert.throws(() => assertAnimationPixelLimit(100, 100, 4, 10_000, 'reports/tall.gif'), /10,000 pixels/iu);
    assert.throws(() => assertAnimationPixelLimit(100, 100, 4, 10_000, 'reports/tall.gif'), /40000 pixels/iu);
  });
});
