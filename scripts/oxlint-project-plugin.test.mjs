import assert from 'node:assert/strict';
import test from 'node:test';

import { findCandidateGroups, isFixedE2EWaitCall, splitIdentifierIntoTokens } from './oxlint-project-plugin.mjs';

function property(name) {
  return {
    computed: false,
    key: { name, type: 'Identifier' },
  };
}

void test('splits PascalCase names into semantic tokens', () => {
  assert.deepStrictEqual(splitIdentifierIntoTokens('CropPdfLabels'), ['crop', 'pdf', 'labels']);
});

void test('reports repeated member-name groups as nesting candidates', () => {
  const candidates = findCandidateGroups([
    property('previewTitle'),
    property('previewDescription'),
    property('previewAriaLabel'),
    property('renderPath'),
    property('renderName'),
  ]);

  assert.deepStrictEqual(candidates, ['preview (3)', 'render (2)']);
});

void test('does not report generic transport tokens as nesting candidates', () => {
  const candidates = findCandidateGroups([property('onReady'), property('onApply'), property('payload')]);

  assert.deepStrictEqual(candidates, []);
});

void test('identifies fixed Playwright waits', () => {
  assert.equal(
    isFixedE2EWaitCall({
      callee: {
        computed: false,
        property: { name: 'waitForTimeout', type: 'Identifier' },
        type: 'MemberExpression',
      },
      type: 'CallExpression',
    }),
    true,
  );
  assert.equal(
    isFixedE2EWaitCall({
      callee: {
        computed: false,
        property: { name: 'waitFor', type: 'Identifier' },
        type: 'MemberExpression',
      },
      type: 'CallExpression',
    }),
    false,
  );
});
