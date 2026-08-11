import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeExtensionCoverage } from '../.github/scripts/render-coverage-report.mjs';

const coreCoverage = ['SF:/workspace/core/src/example.ts', 'DA:1,1', 'end_of_record'].join('\n');
const vscodeCoverage = ['SF:C:\\workspace\\vscode\\src\\extension.ts', 'DA:2,2', 'end_of_record'].join('\n');

void test('coverage report collector includes Core and VS Code ownership paths', () => {
  const summary = summarizeExtensionCoverage(`${coreCoverage}\n${vscodeCoverage}`, 'Linux');
  assert.deepStrictEqual([...summary.files.keys()], ['core/src/example.ts', 'vscode/src/extension.ts']);
  assert.equal(summary.total, 2);
  assert.equal(summary.covered, 2);
});

void test('coverage report collector rejects empty and single-owner LCOV', () => {
  assert.throws(() => summarizeExtensionCoverage('', 'Linux'), /Linux Extension Host coverage is empty/u);
  assert.throws(() => summarizeExtensionCoverage(coreCoverage, 'Linux'), /does not contain vscode\/src\/ sources/u);
});
