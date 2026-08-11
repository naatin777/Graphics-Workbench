import assert from 'node:assert/strict';
import test from 'node:test';

import { collectModuleSpecifiers } from './check-core-imports.mjs';

void test('collects every supported static module reference form', () => {
  const specifiers = collectModuleSpecifiers(`
    import 'vscode';
    import type { ExtensionContext } from 'vscode/types';
    export { window } from 'vscode/window';
    const dynamic = import('@opentui/core');
    const commonJs = require('vscode/commonjs');
    import vscode = require('vscode/import-equals');
    /// <reference types="vscode/reference" />
  `);

  assert.deepStrictEqual(
    [...specifiers].toSorted((left, right) => left.localeCompare(right)),
    [
      '@opentui/core',
      'vscode',
      'vscode/commonjs',
      'vscode/import-equals',
      'vscode/reference',
      'vscode/types',
      'vscode/window',
    ],
  );
});
