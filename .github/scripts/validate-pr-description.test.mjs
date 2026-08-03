import assert from 'node:assert/strict';
import test from 'node:test';

import { findEnvironmentSpecificPaths } from './environment-paths.mjs';
import { validatePrDescription } from './validate-pr-description.mjs';

void test('テンプレートのコメントと単独のplaceholderは空として扱う', () => {
  const result = validatePrDescription(`## Verification\n\n<!-- instructions -->\n\n-\n\n## Risk / Review focus`);
  assert.deepStrictEqual(result, {
    valid: false,
    reason: '## Verification must contain commands and results, or an explicit reason it was not run.',
  });
});

void test('検証コマンドと未検証理由を受け入れる', () => {
  assert.deepStrictEqual(
    validatePrDescription(
      `## Verification\n\n- npm run check:all (pass)\n- Playwright: not run locally because Electron aborts\n\n## Risk / Review focus`,
    ),
    { valid: true },
  );
});

void test('Dependabotの自動生成PRはVerification見出しがなくても受け入れる', () => {
  assert.deepStrictEqual(validatePrDescription('', { authorLogin: 'dependabot[bot]' }), { valid: true });
});

void test('PR本文の環境依存パスを拒否する', () => {
  const localPath = ['', 'Users', 'alice', 'project'].join('/');

  assert.deepStrictEqual(
    validatePrDescription(`## Verification\n\n- ${localPath} (pass)`, {
      authorLogin: 'dependabot[bot]',
    }),
    {
      valid: false,
      reason: 'PR body must not contain environment-specific absolute paths (line 3).',
    },
  );
});

void test('OS別の環境依存パスだけを検出する', () => {
  const posixUserHomePath = ['', 'Users', 'alice', 'project'].join('/');
  const linuxUserHomePath = ['', 'home', 'alice', 'project'].join('/');
  const windowsUserHomePath = ['C:', 'Users', 'alice', 'project'].join('\\');
  const macTemporaryPath = ['', 'private', 'var', 'folders', 'xx'].join('/');

  assert.deepStrictEqual(
    findEnvironmentSpecificPaths(
      [posixUserHomePath, linuxUserHomePath, windowsUserHomePath, macTemporaryPath].join('\n'),
    ),
    [
      { line: 1, label: 'POSIX user-home path' },
      { line: 2, label: 'POSIX user-home path' },
      { line: 3, label: 'Windows user-home path' },
      { line: 4, label: 'macOS temporary path' },
    ],
  );

  assert.deepStrictEqual(findEnvironmentSpecificPaths(posixUserHomePath), [{ line: 1, label: 'POSIX user-home path' }]);
});

void test('Verification見出しがない本文を拒否する', () => {
  assert.deepStrictEqual(validatePrDescription('## Summary\n\n- change'), {
    valid: false,
    reason: 'PR body must contain a ## Verification section.',
  });
});
