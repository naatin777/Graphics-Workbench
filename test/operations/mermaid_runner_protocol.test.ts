import assert from 'node:assert/strict';

import {
  isMermaidRunnerFailure,
  isMermaidRunnerRequest,
  isMermaidRunnerSuccess,
  parseMermaidRunnerRequest,
} from '../../src/operations/conversion/tools/mermaid_runner_protocol.js';

const request = {
  sourcePath: '/tmp/input.mmd',
  outputPath: '/tmp/output.svg',
  outputFormat: 'svg',
  puppeteerConfig: { headless: true },
  backgroundColor: 'white',
  theme: 'default',
} as const;

suite('Mermaid runner protocol', () => {
  test('正しいrequest envelopeを受け付ける', () => {
    assert.equal(isMermaidRunnerRequest(request), true);
    assert.deepEqual(parseMermaidRunnerRequest(request), request);
  });

  test('requestの余分なキーを拒否する', () => {
    assert.equal(isMermaidRunnerRequest({ ...request, extra: true }), false);
    assert.throws(() => parseMermaidRunnerRequest({ ...request, extra: true }), /Invalid Mermaid runner request/);
  });

  test('success responseはokだけを受け付ける', () => {
    assert.equal(isMermaidRunnerSuccess({ ok: true }), true);
    assert.equal(isMermaidRunnerSuccess({ ok: true, extra: true }), false);
  });

  test('failure responseはokとerrorだけを受け付ける', () => {
    assert.equal(isMermaidRunnerFailure({ ok: false, error: 'failed' }), true);
    assert.equal(isMermaidRunnerFailure({ ok: false, error: 'failed', extra: true }), false);
    assert.equal(isMermaidRunnerFailure({ ok: false }), false);
  });
});
