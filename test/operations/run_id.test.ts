import assert from 'node:assert/strict';

import { asRunId, createRunId, isSafePathSegment } from '../../src/operations/lifecycle/run_id.js';
import { sanitizePdfPathSegment } from '../../src/operations/pdf/pdf_path_validation.js';

suite('変換処理ごとに採番するIDが一時ディレクトリのパス要素として安全かを検証する', () => {
  test('安全な文字列の実行IDはpath segmentとして受け入れ、検証済みIDとしてそのまま返す', () => {
    assert.equal(isSafePathSegment('test-run_1.2'), true);
    assert.equal(asRunId('test-run_1.2'), 'test-run_1.2');
  });

  test('実行IDを時刻+UUID形式で生成すると、数字+UUID形式の実行IDで安全なpath segmentとなる', () => {
    const runId = createRunId();

    assert.equal(isSafePathSegment(runId), true);
    assert.match(runId, /^\d+-[0-9a-f-]{36}$/u);
  });

  test('..などの相対path、/や\\を含むpath、Windows予約名CON.pdf、129文字以上のsegmentはpath segmentとして拒否する', () => {
    for (const value of ['.', '..', '../../src', 'item/input', 'item\\input', 'CON.pdf', 'a'.repeat(129)]) {
      assert.equal(isSafePathSegment(value), false, value);
      assert.throws(() => asRunId(value), /Unsafe runId/iu);
    }
  });

  test('sanitizePdfPathSegmentは..や.やCONなどの危険なbasenameを"pdf"へ、日本語などの非ASCIIを含むbasenameをアンダースコアへ置き換える', () => {
    assert.equal(sanitizePdfPathSegment('..'), 'pdf');
    assert.equal(sanitizePdfPathSegment('.'), 'pdf');
    assert.equal(sanitizePdfPathSegment('CON'), 'pdf');
    assert.equal(sanitizePdfPathSegment('日本語 file'), '____file');
  });
});
