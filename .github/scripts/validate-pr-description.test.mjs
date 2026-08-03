import assert from 'node:assert/strict';
import test from 'node:test';

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

void test('Verification見出しがない本文を拒否する', () => {
  assert.deepStrictEqual(validatePrDescription('## Summary\n\n- change'), {
    valid: false,
    reason: 'PR body must contain a ## Verification section.',
  });
});
