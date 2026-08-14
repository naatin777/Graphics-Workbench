import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExtensionHostRuntimeCoverageGlobs,
  isExtensionHostSourcePath,
  normalizeExtensionHostSourcePath,
  verifyExtensionHostLcov,
} from './extension-host-coverage.mjs';

test('normalizeExtensionHostSourcePath: LCOVの相対パスをcanonicalなcore/src・vscode/extension/src形式へ変換する', () => {
  assert.strictEqual(normalizeExtensionHostSourcePath('../../core/src/operations/foo.ts'), 'core/src/operations/foo.ts');
  assert.strictEqual(normalizeExtensionHostSourcePath('src/extension.ts'), 'vscode/extension/src/extension.ts');
  assert.strictEqual(normalizeExtensionHostSourcePath('src/commands/convert_to_pdf.ts'), 'vscode/extension/src/commands/convert_to_pdf.ts');
  assert.strictEqual(normalizeExtensionHostSourcePath('core/src/foo.ts'), 'core/src/foo.ts');
  assert.strictEqual(normalizeExtensionHostSourcePath('vscode/extension/src/foo.ts'), 'vscode/extension/src/foo.ts');
  assert.strictEqual(normalizeExtensionHostSourcePath('foo.ts'), 'foo.ts');
});

test('normalizeExtensionHostSourcePath: Windowsパスとfile URLも同じcanonical形式になる', () => {
  assert.strictEqual(
    normalizeExtensionHostSourcePath('D:\\a\\Graphics-Workbench\\vscode\\extension\\src\\extension.ts'),
    'vscode/extension/src/extension.ts',
  );
  assert.strictEqual(
    normalizeExtensionHostSourcePath('D:\\a\\Graphics-Workbench\\core\\src\\operations\\foo.ts'),
    'core/src/operations/foo.ts',
  );
  assert.strictEqual(
    normalizeExtensionHostSourcePath('file:///home/runner/work/graphics-workbench/vscode/extension/src/foo.ts'),
    'vscode/extension/src/foo.ts',
  );
  assert.strictEqual(
    normalizeExtensionHostSourcePath('file:///home/runner/work/graphics-workbench/core/src/foo.ts'),
    'core/src/foo.ts',
  );
});

test('isExtensionHostSourcePath: core/srcとvscode/extension/srcの両方を正しく判定する', () => {
  assert.strictEqual(isExtensionHostSourcePath('../../core/src/foo.ts'), true);
  assert.strictEqual(isExtensionHostSourcePath('src/extension.ts'), true);
  assert.strictEqual(isExtensionHostSourcePath('vscode/extension/src/foo.ts'), true);
  assert.strictEqual(isExtensionHostSourcePath('src/other/foo.ts'), true);
  assert.strictEqual(isExtensionHostSourcePath('somewhere/else.ts'), false);
});

test('buildExtensionHostRuntimeCoverageGlobsはcore/distとextensionのout配下srcを対象にする', () => {
  const repositoryDirectory = '/repo';
  const globs = buildExtensionHostRuntimeCoverageGlobs(repositoryDirectory);

  assert.deepStrictEqual(globs, [
    '/repo/core/dist/**/*.js',
    '/repo/vscode/extension/out/vscode/extension/src/**/*.js',
  ]);
});

test('verifyExtensionHostLcov: extension package基準のsrc/...とcore/src/...のLCOVを受け入れる', () => {
  const lcov = [
    'SF:src/extension.ts',
    'DA:1,1',
    'DA:2,0',
    'end_of_record',
    'SF:../../core/src/operations/foo.ts',
    'DA:1,3',
    'end_of_record',
  ].join('\n');

  const result = verifyExtensionHostLcov(lcov);

  assert.strictEqual(result.sourceFiles, 2);
  assert.strictEqual(result.executedLines, 2);
});

test('verifyExtensionHostLcov: vscode/extension/srcが欠けるLCOVはエラーにする', () => {
  const lcov = ['SF:../../core/src/foo.ts', 'DA:1,1', 'end_of_record'].join('\n');

  assert.throws(() => verifyExtensionHostLcov(lcov), /does not contain vscode\/extension\/src\/ sources/u);
});

test('verifyExtensionHostLcov: core/srcが欠けるLCOVはエラーにする', () => {
  const lcov = ['SF:src/extension.ts', 'DA:1,1', 'end_of_record'].join('\n');

  assert.throws(() => verifyExtensionHostLcov(lcov), /does not contain core\/src\/ sources/u);
});

test('verifyExtensionHostLcov: 実行行が0のprefixはエラーにする', () => {
  const lcov = [
    'SF:src/extension.ts',
    'DA:1,0',
    'end_of_record',
    'SF:../../core/src/foo.ts',
    'DA:1,1',
    'end_of_record',
  ].join('\n');

  assert.throws(() => verifyExtensionHostLcov(lcov), /has no executed lines for vscode\/extension\/src\/ sources/u);
});

test('verifyExtensionHostLcov: 空のLCOVはエラーにする', () => {
  assert.throws(() => verifyExtensionHostLcov(''), /is empty/u);
});
