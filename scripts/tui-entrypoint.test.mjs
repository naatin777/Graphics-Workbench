import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('root TUI script preserves the caller working directory so relative PDF arguments resolve from the repository root', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.strictEqual(packageJson.scripts.tui, 'bun run tui/src/main.ts');
});
