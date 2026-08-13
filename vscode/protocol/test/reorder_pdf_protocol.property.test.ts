import assert from 'node:assert/strict';

import * as fc from 'fast-check';

import { suite, test } from 'mocha';

import {
  isReorderPdfHostToWebviewMessage,
  isReorderPdfWebviewToHostMessage,
} from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';

const pageOrderArbitrary = fc.array(fc.integer({ min: 1, max: 20 }), {
  minLength: 1,
  maxLength: 8,
});

suite('PDFページ並び替えprotocolのValibot validator property-based test', () => {
  test('任意のJSON値をhost/webview validatorへ渡してもthrowせず、結果はbooleanになる', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        let hostResult = false;
        let webviewResult = false;

        assert.doesNotThrow(() => {
          hostResult = isReorderPdfHostToWebviewMessage(value);
          webviewResult = isReorderPdfWebviewToHostMessage(value);
        });
        assert.strictEqual(typeof hostResult, 'boolean');
        assert.strictEqual(typeof webviewResult, 'boolean');
      }),
    );
  });

  test('1以上の整数だけからなる縮小可能なpage order配列はapply messageとして受け入れられる', () => {
    fc.assert(
      fc.property(pageOrderArbitrary, (order) => {
        assert.strictEqual(isReorderPdfWebviewToHostMessage({ type: 'apply', payload: { order } }), true);
      }),
    );
  });

  test('正しいapply messageへ任意の余分な最上位キーを追加するとstrict validatorが拒否する', () => {
    fc.assert(
      fc.property(pageOrderArbitrary, fc.jsonValue(), (order, extra) => {
        assert.strictEqual(isReorderPdfWebviewToHostMessage({ type: 'apply', payload: { order }, extra }), false);
      }),
    );
  });
});
