import assert from 'node:assert/strict';

import { asRunId, createRunId, isSafePathSegment } from '../../src/operations/lifecycle/run_id.js';
import { sanitizePdfPathSegment } from '../../src/operations/pdf/pdf_job_paths.js';

suite('内部path segment', () => {
  test('生成用のrunIdだけを受け入れる', () => {
    assert.equal(isSafePathSegment('test-run_1.2'), true);
    assert.equal(asRunId('test-run_1.2'), 'test-run_1.2');
  });

  test('operation共通のrunIdを安全なpath segmentとして生成する', () => {
    const runId = createRunId();

    assert.equal(isSafePathSegment(runId), true);
    assert.match(runId, /^\d+-[0-9a-f-]{36}$/u);
  });

  test('dot、separator、Windows予約名、長すぎるsegmentを拒否する', () => {
    for (const value of ['.', '..', '../../src', 'item/input', 'item\\input', 'CON.pdf', 'a'.repeat(129)]) {
      assert.equal(isSafePathSegment(value), false, value);
      assert.throws(() => asRunId(value), /Unsafe runId/iu);
    }
  });

  test('ユーザー由来のsanitizePdfPathSegmentは危険なbasenameをfallbackへ変換する', () => {
    assert.equal(sanitizePdfPathSegment('..'), 'pdf');
    assert.equal(sanitizePdfPathSegment('.'), 'pdf');
    assert.equal(sanitizePdfPathSegment('CON'), 'pdf');
    assert.equal(sanitizePdfPathSegment('日本語 file'), '____file');
  });
});
