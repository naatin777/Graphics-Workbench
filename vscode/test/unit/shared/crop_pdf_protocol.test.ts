import assert from 'node:assert/strict';

import { isCropConfigureMessage } from '../../../src/shared/protocols/crop_pdf_protocol.js';

suite('Crop PDFのWebview操作メッセージの受信判定（ready/apply/previewLoadFailed）', () => {
  test('cropBoxの4座標がすべて有限数値で、targetがselected・正の整数pagesであるapplyメッセージを受け入れる', () => {
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

  test('messageだけを持つpreviewLoadFailedメッセージを受け入れ、cropBox座標にNaNを含むapplyメッセージは有限数値チェックで拒否する', () => {
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

  test('readyにrequestId等の余分なトップレベルキーを持つ場合・payloadにmessage以外のcodeを持つ場合・applyにsourcePathを持つ場合・typeが空文字の場合をすべて拒否する', () => {
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
