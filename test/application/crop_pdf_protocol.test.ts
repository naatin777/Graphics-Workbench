import assert from 'node:assert/strict';

import { isCropConfigureMessage } from '../../src/application/protocols/crop_pdf_protocol.js';

suite('Crop PDF Webviewプロトコル', () => {
  test('valid apply payloadを受け入れる', () => {
    assert.equal(
      isCropConfigureMessage({
        type: 'apply',
        payload: {
          cropBox: { left: 0, bottom: 0, right: 100, top: 80 },
          target: { type: 'selected', pages: [1, 2] },
        },
      }),
      true,
    );
  });

  test('preview errorと不正なapply payloadを区別する', () => {
    assert.equal(
      isCropConfigureMessage({
        type: 'previewLoadFailed',
        payload: { message: 'failed' },
      }),
      true,
    );
    assert.equal(
      isCropConfigureMessage({
        type: 'apply',
        payload: {
          cropBox: { left: 0, bottom: 0, right: Number.NaN, top: 80 },
          target: { type: 'all' },
        },
      }),
      false,
    );
  });

  test('共有envelopeの余分なキーと空のtypeを拒否する', () => {
    assert.equal(isCropConfigureMessage({ type: 'ready', requestId: 'request-1' }), false);
    assert.equal(
      isCropConfigureMessage({ type: 'previewLoadFailed', payload: { message: 'failed', code: 'E_FAIL' } }),
      false,
    );
    assert.equal(
      isCropConfigureMessage({
        type: 'apply',
        payload: {
          cropBox: { left: 0, bottom: 0, right: 100, top: 80 },
          target: { type: 'all' },
          sourcePath: '/not-allowed',
        },
      }),
      false,
    );
    assert.equal(isCropConfigureMessage({ type: '' }), false);
  });
});
