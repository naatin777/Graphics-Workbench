import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findCandidateGroups,
  getMissingProcessEnvelopeFields,
  getStaticPropertyName,
  hasSensitiveIdentifier,
  isAllowedChildProcessFile,
  isFixedE2EWaitCall,
  isProcessProtocolFile,
  isWebviewAppSourceFile,
  splitIdentifierIntoTokens,
} from './oxlint-project-plugin.mjs';

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

void test('limits Webview API rules to app source files and keeps the wrapper allowed', () => {
  assert.equal(isWebviewAppSourceFile('/workspace/webview/apps/crop_pdf/src/app.tsx'), true);
  assert.equal(isWebviewAppSourceFile('/workspace/webview/apps/crop_pdf/src/vscode.ts'), true);
  assert.equal(isWebviewAppSourceFile('/workspace/webview/shared/vscode.ts'), false);
});

void test('recognizes static AST property names', () => {
  assert.equal(getStaticPropertyName({ name: 'requestId', type: 'Identifier' }), 'requestId');
  assert.equal(getStaticPropertyName({ type: 'Literal', value: 'protocolVersion' }), 'protocolVersion');
  assert.equal(getStaticPropertyName({ type: 'Literal', value: 1 }), undefined);
});

void test('requires process envelope fields on protocol declarations', () => {
  assert.deepStrictEqual(
    getMissingProcessEnvelopeFields({
      id: { name: 'CropPdfProcessSuccess' },
      type: 'TSInterfaceDeclaration',
      body: {
        body: [
          property('type'),
          property('protocolVersion'),
          property('requestId'),
        ],
      },
    }),
    [],
  );
  assert.deepStrictEqual(
    getMissingProcessEnvelopeFields({
      id: { name: 'CropPdfProcessFailure' },
      type: 'TSInterfaceDeclaration',
      body: { body: [property('type')] },
    }),
    ['protocolVersion', 'requestId'],
  );
});

void test('identifies sensitive values and child-process boundaries', () => {
  assert.equal(hasSensitiveIdentifier({ name: 'jobJsonPath', type: 'Identifier' }), true);
  assert.equal(hasSensitiveIdentifier({ name: 'requestId', type: 'Identifier' }), false);
  assert.equal(hasSensitiveIdentifier({ name: 'tokenize', type: 'Identifier' }), false);
  assert.equal(isProcessProtocolFile('/workspace/src/operations/pdf/crop_pdf_process_protocol.ts'), true);
  assert.equal(isProcessProtocolFile('/workspace/src/operations/pdf/crop_pdf_core.ts'), false);
  assert.equal(isAllowedChildProcessFile('/workspace/src/operations/external_tools/run_external_tool.ts'), true);
  assert.equal(isAllowedChildProcessFile('/workspace/src/commands/open_file.ts'), false);
});
