import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { buildExtensionHostRuntimeCoverageGlobs, verifyExtensionHostLcov } from './extension-host-coverage.mjs';

const coreCoverage = ['SF:/workspace/core/src/operations/example.ts', 'DA:1,1', 'end_of_record'].join('\n');
const vscodeCoverage = ['SF:C:\\workspace\\vscode\\src\\extension.ts', 'DA:2,3', 'end_of_record'].join('\n');

void test('coverage runtime globs are absolute and include both compiled production roots', () => {
  assert.deepStrictEqual(buildExtensionHostRuntimeCoverageGlobs(path.resolve('/workspace')), [
    '/workspace/core/dist/**/*.js',
    '/workspace/vscode/out/vscode/src/**/*.js',
  ]);
});

void test('Extension Host LCOV requires executed Core and VS Code production sources', () => {
  assert.deepStrictEqual(verifyExtensionHostLcov(`${coreCoverage}\n${vscodeCoverage}`), {
    executedLines: 2,
    sourceFiles: 2,
  });
});

void test('Extension Host LCOV rejects empty and single-owner reports', () => {
  assert.throws(() => verifyExtensionHostLcov(''), /Extension Host coverage is empty/u);
  assert.throws(() => verifyExtensionHostLcov(coreCoverage), /does not contain vscode\/src\/ sources/u);
});

void test('Extension Host LCOV rejects an owner with no executed production lines', () => {
  const uncoveredVscode = ['SF:/workspace/vscode/src/extension.ts', 'DA:2,0', 'end_of_record'].join('\n');
  assert.throws(
    () => verifyExtensionHostLcov(`${coreCoverage}\n${uncoveredVscode}`),
    /no executed lines for vscode\/src\/ sources/u,
  );
});
