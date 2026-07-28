import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPreflightPassed,
  runPreflightBatch,
  type PreflightReport,
} from '../../src/operations/input/input_preflight.js';
import { requireValue } from '../helpers/required.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(testDirectory, '..', '..', '..', 'test', 'fixtures', 'preflight');

function assertOk(report: PreflightReport): void {
  strictEqual(
    report.result,
    'ok',
    `Expected OK for ${path.basename(report.sourcePath)}, got ${report.result}: ${report.reason ?? ''}`,
  );
}

function assertError(report: PreflightReport, messageContains?: string): void {
  strictEqual(report.result, 'error', `Expected ERROR for ${path.basename(report.sourcePath)}, got ${report.result}`);
  if (messageContains !== undefined) {
    ok(
      report.reason?.includes(messageContains),
      `Expected reason to contain "${messageContains}", got: ${report.reason ?? '(none)'}`,
    );
  }
}

suite('Preflight — 共通検査', () => {
  test('空ファイルをerrorとして検出する', async () => {
    const result = await runPreflightBatch([path.join(FIXTURES, 'empty.pdf')]);
    strictEqual(result.canProceed, false);
    strictEqual(result.errors.length, 1);
    assertError(requireValue(result.errors[0]), 'Empty file');
  });

  test('読み込めない入力をFile not readable errorとして検出する', async () => {
    const result = await runPreflightBatch([path.join(FIXTURES, 'missing.pdf')]);
    strictEqual(result.canProceed, false);
    strictEqual(result.errors.length, 1);
    assertError(requireValue(result.errors[0]), 'File not readable');
  });

  test('未対応の拡張子をerrorとして検出する', async () => {
    const result = await runPreflightBatch([path.join(FIXTURES, 'valid.pdf') + '.unknown']);
    strictEqual(result.canProceed, false);
    assertError(requireValue(result.errors[0]), 'Unsupported format');
  });

  test('対応拡張子を持つdirectoryを入力fileとして扱わない', async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), 'lgh-preflight-directory-'));
    const disguisedDirectory = path.join(testRoot, 'diagram.drawio.png');

    try {
      await mkdir(disguisedDirectory);
      const result = await runPreflightBatch([disguisedDirectory]);
      strictEqual(result.canProceed, false);
      assertError(requireValue(result.errors[0]), 'not a regular file');
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  test('複数ファイルを同時に検査する', async () => {
    const result = await runPreflightBatch([
      path.join(FIXTURES, 'valid.pdf'),
      path.join(FIXTURES, 'valid.png'),
      path.join(FIXTURES, 'empty.pdf'),
    ]);
    strictEqual(result.canProceed, false);
    strictEqual(result.errors.length, 1);
    strictEqual(requireValue(result.errors[0]).result, 'error');
    const oks = result.reports.filter((report) => report.result === 'ok');
    strictEqual(oks.length, 2);
  });

  test('全件okの場合はcanProceedがtrue', async () => {
    const result = await runPreflightBatch([path.join(FIXTURES, 'valid.pdf'), path.join(FIXTURES, 'valid.png')]);
    strictEqual(result.canProceed, true);
    strictEqual(result.errors.length, 0);
  });

  test('失敗理由に入力pathを含める', async () => {
    const missingPath = path.join(FIXTURES, 'missing.pdf');
    await rejects(assertPreflightPassed([{ sourcePath: missingPath }]), (error: unknown) => {
      return (
        error instanceof Error && error.message.includes(missingPath) && error.message.includes('File not readable')
      );
    });
  });
});

suite('Preflight — バッチライフサイクル', () => {
  test('開始前にキャンセル済みならAbortErrorを伝播する', async () => {
    const controller = new AbortController();
    controller.abort();
    const reason = controller.signal.reason;

    ok(reason instanceof Error);
    strictEqual(reason.name, 'AbortError');
    await rejects(
      runPreflightBatch([path.join(FIXTURES, 'valid.pdf')], {
        signal: controller.signal,
      }),
      (error: unknown) => error === reason,
    );
  });

  test('キャンセル後はvalidatorを開始しない', async () => {
    const controller = new AbortController();
    const sourcePaths = [
      path.join(FIXTURES, 'valid.pdf'),
      path.join(FIXTURES, 'valid.png'),
      path.join(FIXTURES, 'valid.svg'),
      path.join(FIXTURES, 'valid.mmd'),
    ];

    // Abort before the batch starts processing
    controller.abort();

    await rejects(
      runPreflightBatch(sourcePaths, { signal: controller.signal }),
      (error: unknown) => error === controller.signal.reason,
    );
  });
});

suite('Preflight — Raw sidecar検査', () => {
  test('Rawは必須sidecarと一致するbyte長があればokになる', async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), 'lgh-preflight-raw-'));
    const sourcePath = path.join(testRoot, 'pixels.raw');
    try {
      await writeFile(sourcePath, Buffer.from([255, 0, 0, 0, 255, 0]));
      await writeFile(
        `${sourcePath}.json`,
        JSON.stringify({
          version: 1,
          width: 2,
          height: 1,
          channels: 3,
          depth: 'uchar',
          colourspace: 'srgb',
          alpha: false,
          layout: 'interleaved',
        }),
      );
      const result = await runPreflightBatch([sourcePath]);
      assertOk(requireValue(result.reports[0]));
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  test('Rawのsidecar不足・無効・byte長不一致を変換前errorにする', async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), 'lgh-preflight-raw-invalid-'));
    try {
      const missingPath = path.join(testRoot, 'missing.raw');
      await writeFile(missingPath, Buffer.from([0]));
      const invalidPath = path.join(testRoot, 'invalid.raw');
      await writeFile(invalidPath, Buffer.from([0]));
      await writeFile(`${invalidPath}.json`, JSON.stringify({ width: 1, height: 1, channels: 5 }));
      const mismatchPath = path.join(testRoot, 'mismatch.raw');
      await writeFile(mismatchPath, Buffer.from([0]));
      await writeFile(
        `${mismatchPath}.json`,
        JSON.stringify({
          version: 1,
          width: 2,
          height: 1,
          channels: 1,
          depth: 'uchar',
          colourspace: 'b-w',
          alpha: false,
          layout: 'interleaved',
        }),
      );

      const result = await runPreflightBatch([missingPath, invalidPath, mismatchPath]);
      strictEqual(result.errors.length, 3);
      ok(result.errors.some((report) => report.reason?.includes('Invalid Raw sidecar')));
      ok(result.errors.some((report) => report.reason?.includes('byte length mismatch')));
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });
});

suite('Preflight — 進捗報告', () => {
  test('onProgress callbackが各ファイル完了後に呼ばれる', async () => {
    const calls: { completed: number; total: number }[] = [];
    const result = await runPreflightBatch(
      [path.join(FIXTURES, 'valid.pdf'), path.join(FIXTURES, 'valid.png'), path.join(FIXTURES, 'valid.svg')],
      {
        onProgress: (completed, total) => {
          calls.push({ completed, total });
        },
      },
    );
    strictEqual(result.canProceed, true);
    strictEqual(result.reports.length, 3);
    strictEqual(calls.length, 3);
    deepStrictEqual(requireValue(calls[0]), { completed: 1, total: 3 });
    deepStrictEqual(requireValue(calls[2]), { completed: 3, total: 3 });
  });
});

suite('Preflight — レポート構造', () => {
  test('各レポートにformat、fileSize、resultが含まれる', async () => {
    const result = await runPreflightBatch([
      path.join(FIXTURES, 'valid.pdf'),
      path.join(FIXTURES, 'valid.png'),
      path.join(FIXTURES, 'valid.svg'),
      path.join(FIXTURES, 'valid.mmd'),
    ]);
    for (const report of result.reports) {
      ok(report.format, `missing format for ${report.sourcePath}`);
      ok(typeof report.fileSize === 'number', `missing fileSize for ${report.sourcePath}`);
      ok(['ok', 'error'].includes(report.result), `invalid result for ${report.sourcePath}`);
    }
  });
});
