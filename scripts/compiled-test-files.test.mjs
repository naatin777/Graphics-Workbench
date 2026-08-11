import assert from 'node:assert/strict';
import { mkdir, mkdtempDisposable, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildVscodeTestArguments, collectCompiledTestFiles } from './compiled-test-files.mjs';

void test('compiled test discovery is recursive, sorted, and excludes the node:test-only suite', async () => {
  await using directory = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-compiled-tests-'));
  await mkdir(path.join(directory.path, 'nested'), { recursive: true });
  await Promise.all([
    writeFile(path.join(directory.path, 'z.test.js'), ''),
    writeFile(path.join(directory.path, 'nested', 'a.test.js'), ''),
    writeFile(path.join(directory.path, 'nested', 'terminate_process_tree.test.js'), ''),
    writeFile(path.join(directory.path, 'nested', 'support.js'), ''),
  ]);

  assert.deepStrictEqual(collectCompiledTestFiles(directory.path, '.', new Set(['terminate_process_tree.test.js'])), [
    path.join('nested', 'a.test.js'),
    'z.test.js',
  ]);
});

void test('core test wrapper passes exact files before forwarding targeted CLI options', () => {
  assert.deepStrictEqual(
    buildVscodeTestArguments(['vscode/out/core/test/unit/a.test.js'], ['--grep', 'page range', '--dry-run']),
    ['--run', 'vscode/out/core/test/unit/a.test.js', '--grep', 'page range', '--dry-run'],
  );
});
