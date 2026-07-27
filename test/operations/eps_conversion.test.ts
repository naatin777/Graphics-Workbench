import { strictEqual } from 'node:assert/strict';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';

suite('EPSソース形式検出', () => {
  test('.eps拡張子をeps形式として検出する', () => {
    strictEqual(sourceFormatForPath('/test/file.eps'), 'eps');
    strictEqual(sourceFormatForPath('/test/FILE.EPS'), 'eps');
  });
});
