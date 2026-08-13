import assert from 'node:assert/strict';

import { suite, test } from 'mocha';

import { rotatePdfProtocol } from '@graphics-workbench/vscode-protocol/rotate-pdf-protocol';

const acceptsHostMessage = (value: unknown): boolean => rotatePdfProtocol.parseHostToWebview(value) !== undefined;
const acceptsWebviewMessage = (value: unknown): boolean => rotatePdfProtocol.parseWebviewToHost(value) !== undefined;

const labels = {
  'webview.rotatePdf.title': 'Rotate PDF',
  'webview.rotatePdf.description': 'description',
  'webview.rotatePdf.preview': 'Preview',
  'webview.rotatePdf.previewDescription': 'description',
  'webview.rotatePdf.previewAriaLabel': 'preview',
  'webview.rotatePdf.previewRenderError': 'error',
  'webview.rotatePdf.previewApplyError': 'error',
  'webview.rotatePdf.rotation': 'Rotation',
  'webview.rotatePdf.angleLabel': 'angle',
  'webview.rotatePdf.selectAll': 'all',
  'webview.rotatePdf.selectAllAriaLabel': 'all',
  'webview.rotatePdf.pageToggle': 'toggle',
  'webview.rotatePdf.pagesRequiredError': 'required',
  'webview.rotatePdf.pageOutOfRangeError': 'range',
  'webview.rotatePdf.angleInvalid': 'invalid',
  'webview.rotatePdf.apply': 'Apply',
  'webview.rotatePdf.cancel': 'Cancel',
};

const initPayload = {
  sourceId: 'source-1',
  fileName: 'source.pdf',
  pageCount: 3,
  pdfSrc: 'vscode-resource://source.pdf',
  resources: {
    workerSrc: 'vscode-resource://pdf.worker.mjs',
    cMapUrl: 'vscode-resource://cmaps/',
    standardFontDataUrl: 'vscode-resource://standard_fonts/',
    wasmUrl: 'vscode-resource://wasm/',
  },
  preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
  labels,
};

suite('Rotate PDFのWebviewとホスト間で送受信するメッセージ形式の判定（init/apply）', () => {
  test('必須フィールドをすべて持つinitメッセージと、90度倍数の角度と非空ページ選択を持つapplyメッセージを受け入れる', () => {
    assert.equal(acceptsHostMessage({ type: 'init', payload: initPayload }), true);
    assert.equal(acceptsWebviewMessage({ type: 'apply', payload: { angle: 180, pageIndices: [1, 3] } }), true);
  });

  test('90度倍数でない角度・空のページ選択・定義外キー・最上位のrequestIdを持つメッセージを拒否する', () => {
    assert.equal(acceptsWebviewMessage({ type: 'apply', payload: { angle: 45, pageIndices: [1] } }), false);
    assert.equal(acceptsWebviewMessage({ type: 'apply', payload: { angle: 90, pageIndices: [] } }), false);
    assert.equal(acceptsHostMessage({ type: 'init', payload: { ...initPayload, sourcePath: '/not-allowed' } }), false);
    assert.equal(
      acceptsWebviewMessage({
        type: 'apply',
        payload: { angle: 90, pageIndices: [1] },
        requestId: 'request-1',
      }),
      false,
    );
  });
});
