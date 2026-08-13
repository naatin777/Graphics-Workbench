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
  packageNameFor,
  requiredMessageArgumentCount,
  splitIdentifierIntoTokens,
  validateUserMessageCall,
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
  assert.equal(isWebviewAppSourceFile('/workspace/vscode/webview/src/pages/crop-pdf/app.tsx'), true);
  assert.equal(isWebviewAppSourceFile('/workspace/vscode/webview/src/pages/crop-pdf/vscode.ts'), true);
  assert.equal(isWebviewAppSourceFile('/workspace/vscode/webview/src/shared/vscode.ts'), false);
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
        body: [property('type'), property('protocolVersion'), property('requestId')],
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
  assert.equal(
    isProcessProtocolFile('/workspace/vscode/extension/src/adapters/crop/crop_pdf_process_protocol.ts'),
    true,
  );
  assert.equal(isProcessProtocolFile('/workspace/vscode/extension/src/adapters/crop/crop_pdf_core.ts'), false);
  assert.equal(isAllowedChildProcessFile('/workspace/core/src/operations/external_tools/run_external_tool.ts'), true);
  assert.equal(isAllowedChildProcessFile('/workspace/vscode/extension/src/commands/open_file.ts'), false);
});

void test('resolves the package name of a module specifier', () => {
  assert.equal(packageNameFor('@graphics-workbench/core/runtime'), '@graphics-workbench/core');
  assert.equal(packageNameFor('@opentui/solid'), '@opentui/solid');
  assert.equal(packageNameFor('vscode/window'), 'vscode');
  assert.equal(packageNameFor('sharp'), 'sharp');
});

void test('derives required userMessage argument counts from NLS placeholders', () => {
  assert.equal(requiredMessageArgumentCount('{0} to {1}'), 2);
  assert.equal(requiredMessageArgumentCount('no placeholders'), 0);
  assert.equal(requiredMessageArgumentCount('{2} only'), 3);
  assert.equal(requiredMessageArgumentCount('{0}{1}{0}'), 2);
});

void test('validates userMessage calls against the English NLS catalog', () => {
  const missingKey = validateUserMessageCall('no.such.key', 1);
  assert.deepStrictEqual(missingKey, ['userMessage call references missing NLS key no.such.key']);

  const tooFew = validateUserMessageCall('message.environmentCheck.failed', 2);
  assert.deepStrictEqual(tooFew, ['userMessage call has too few arguments for message.environmentCheck.failed']);

  assert.deepStrictEqual(validateUserMessageCall('message.environmentCheck.failed', 3), []);
  assert.deepStrictEqual(validateUserMessageCall('message.combineImagesToPdf.requiresTwo', 1), []);
});
