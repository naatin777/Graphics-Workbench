import assert from 'node:assert/strict';
import test from 'node:test';

import { validateUserMessageSource } from './check-nls.mjs';

void test('validateUserMessageSource counts nested arguments and reports missing placeholders', () => {
  const source = `
    userMessage("two.placeholders", value);
    userMessage("two.placeholders", format(a, b));
    userMessage("two.placeholders", value, other);
  `;

  assert.strictEqual(validateUserMessageSource('fixture.ts', source, { 'two.placeholders': '{0} {1}' }).length, 2);
});
