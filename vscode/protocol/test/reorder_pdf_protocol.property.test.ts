import assert from 'node:assert/strict';

import * as fc from 'fast-check';

import { reorderPdfProtocol } from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';

const acceptsHostMessage = (value: unknown): boolean => reorderPdfProtocol.parseHostToWebview(value) !== undefined;
const acceptsWebviewMessage = (value: unknown): boolean => reorderPdfProtocol.parseWebviewToHost(value) !== undefined;

const pageOrderArbitrary = fc.array(fc.integer({ min: 1, max: 20 }), {
  minLength: 1,
  maxLength: 8,
});

describe('PDFページ並び替えprotocolのValibot validator property-based test', () => {
  it('任意のJSON値をhost/webview validatorへ渡してもthrowせず、結果はbooleanになる', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        let hostResult = false;
        let webviewResult = false;

        assert.doesNotThrow(() => {
          hostResult = acceptsHostMessage(value);
          webviewResult = acceptsWebviewMessage(value);
        });
        assert.strictEqual(typeof hostResult, 'boolean');
        assert.strictEqual(typeof webviewResult, 'boolean');
      }),
    );
  });

  it('1以上の整数だけからなる縮小可能なpage order配列はapply messageとして受け入れられる', () => {
    fc.assert(
      fc.property(pageOrderArbitrary, (order) => {
        assert.strictEqual(acceptsWebviewMessage({ type: 'apply', payload: { order } }), true);
      }),
    );
  });

  it('正しいapply messageへ任意の余分な最上位キーを追加するとstrict validatorが拒否する', () => {
    fc.assert(
      fc.property(pageOrderArbitrary, fc.jsonValue(), (order, extra) => {
        assert.strictEqual(acceptsWebviewMessage({ type: 'apply', payload: { order }, extra }), false);
      }),
    );
  });
});
