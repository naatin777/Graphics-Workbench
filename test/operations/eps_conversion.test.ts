import { ok, strictEqual } from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { validateEpsInput } from '../../src/operations/conversion/eps_to_pdf.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(testDirectory, '..', '..', '..', 'test', 'fixtures', 'eps');

suite('EPS入力preflight検証', () => {
  test('有効な最小EPSファイルを受け付ける', async () => {
    const epsPath = path.join(FIXTURES_DIR, 'minimal.eps');
    await validateEpsInput(epsPath);
    ok(true, 'validateEpsInput did not throw for valid EPS');
  });

  test('PostScriptヘッダのないファイルを拒否する', async () => {
    const epsPath = path.join(FIXTURES_DIR, 'no-header.eps');
    try {
      await validateEpsInput(epsPath);
    } catch (error) {
      strictEqual(
        (error as Error).message.includes('PostScript header'),
        true,
        `Unexpected error message: ${(error as Error).message}`,
      );
      return;
    }
    ok(false, 'Expected validateEpsInput to throw');
  });

  test('無効なBoundingBoxのEPSを拒否する', async () => {
    const epsPath = path.join(FIXTURES_DIR, 'invalid-bbox.eps');
    try {
      await validateEpsInput(epsPath);
    } catch (error) {
      strictEqual(
        (error as Error).message.includes('Invalid BoundingBox'),
        true,
        `Unexpected error message: ${(error as Error).message}`,
      );
      return;
    }
    ok(false, 'Expected validateEpsInput to throw');
  });
});

suite('EPSソース形式検出', () => {
  test('.eps拡張子をeps形式として検出する', () => {
    strictEqual(sourceFormatForPath('/test/file.eps'), 'eps');
    strictEqual(sourceFormatForPath('/test/FILE.EPS'), 'eps');
  });
});
