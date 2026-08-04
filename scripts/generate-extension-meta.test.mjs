import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'src/generated/extension_manifest.ts');

void test('old generated metadata files are removed', () => {
  for (const stalePath of ['src/generated-extension-meta.ts', 'src/generated-extension-config.ts']) {
    assert.strictEqual(
      existsSync(path.join(repositoryRoot, stalePath)),
      false,
      `${stalePath} must not remain as a stale generated file`,
    );
  }
});

void test('generated manifest is pure and does not import the VS Code API', () => {
  const content = readFileSync(manifestPath, 'utf8');
  assert.doesNotMatch(content, /from\s+'vscode'/u);
  assert.match(content, /export const publicCommandIds/u);
  assert.match(content, /export type CommandId/u);
  assert.match(content, /export function createConfiguration/u);
  assert.match(content, /export const getDefaultConfiguration/u);
  assert.match(content, /export const conversionPairs/u);
});

void test('generated manifest imports in plain Node without vscode', () => {
  const script = `
    const manifest = await import(${JSON.stringify(manifestPath)});
    if (typeof manifest.getDefaultConfiguration !== 'function') process.exit(1);
    if (typeof manifest.createConfiguration !== 'function') process.exit(2);
    if (typeof manifest.conversionPairs !== 'object') process.exit(3);
    if (!Array.isArray(manifest.publicCommandIds) || manifest.publicCommandIds.length === 0) process.exit(4);
    process.exit(0);
  `;
  execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
});
