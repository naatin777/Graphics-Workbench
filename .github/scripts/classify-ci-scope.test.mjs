import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyCiScope } from './classify-ci-scope.mjs';

void test('docs/README等の文書のみの変更はdocsスコープになりPlaywrightを実行しない', () => {
  assert.deepStrictEqual(
    classifyCiScope(['docs/README.md', 'README.ja.md', '.opencode/skills/a.md', 'CHANGELOG.md', 'LICENSE']),
    { scope: 'docs', runPlaywright: false },
  );
});

void test('srcを変更した場合はcodeスコープでPlaywrightを実行する', () => {
  assert.deepStrictEqual(classifyCiScope(['src/commands/conversion/convert_to_pdf.ts']), {
    scope: 'code',
    runPlaywright: true,
  });
});

void test('webview変更はcodeスコープでPlaywrightを実行する', () => {
  assert.deepStrictEqual(classifyCiScope(['webview/apps/crop_pdf/App.tsx']), {
    scope: 'code',
    runPlaywright: true,
  });
});

void test('extension-hostテストのみの変更はcodeスコープだがPlaywrightは実行しない', () => {
  assert.deepStrictEqual(classifyCiScope(['test/operations/raster_fixture_matrix.test.ts']), {
    scope: 'code',
    runPlaywright: false,
  });
});

void test('workflow変更はcodeスコープでPlaywrightを実行する', () => {
  assert.deepStrictEqual(classifyCiScope(['.github/workflows/playwright.yml']), {
    scope: 'code',
    runPlaywright: true,
  });
});

void test('未知のファイルはcodeスコープへ倒す', () => {
  assert.deepStrictEqual(classifyCiScope(['unknown/file.bin']), { scope: 'code', runPlaywright: true });
});
