import assert from 'node:assert/strict';

import { previewProtocol } from '@graphics-workbench/vscode-protocol/preview-protocol';

const acceptsWebviewMessage = (value: unknown): boolean => previewProtocol.parseWebviewToHost(value) !== undefined;
const acceptsHostMessage = (value: unknown): boolean => previewProtocol.parseHostToWebview(value) !== undefined;

const hostInitBase = {
  fileName: 'sample.pdf',
  pageCount: 1,
  preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
  labels: {
    'webview.preview.title': 'Preview',
    'webview.preview.description': 'Preview the file contents.',
    'webview.preview.pageLabel': 'Page',
    'webview.preview.pages': 'pages',
    'webview.preview.previewAriaLabel': 'Preview',
    'webview.preview.zoomLabel': 'Preview zoom',
    'webview.preview.zoomOut': 'Zoom out',
    'webview.preview.zoomIn': 'Zoom in',
    'webview.preview.renderError': 'Could not display the preview',
  },
} as const;

const hostPdfResources = {
  workerSrc: 'vscode-resource://pdf.worker.mjs',
  cMapUrl: 'vscode-resource://cmaps/',
  standardFontDataUrl: 'vscode-resource://standard_fonts/',
  wasmUrl: 'vscode-resource://wasm/',
} as const;

describe('PDF/TIFF previewのWebview操作メッセージの受信判定（ready/renderPage/previewLoadFailed）', () => {
  it('readyとcancelを余分なキーなしで受け入れる', () => {
    assert.equal(acceptsWebviewMessage({ type: 'ready' }), true);
    assert.equal(acceptsWebviewMessage({ type: 'cancel' }), true);
  });

  it('正の整数pageを持つrenderPageを受け入れ、0・負数・小数・文字列のpageは拒否する', () => {
    assert.equal(acceptsWebviewMessage({ type: 'renderPage', payload: { page: 1 } }), true);
    assert.equal(acceptsWebviewMessage({ type: 'renderPage', payload: { page: 0 } }), false);
    assert.equal(acceptsWebviewMessage({ type: 'renderPage', payload: { page: -1 } }), false);
    assert.equal(acceptsWebviewMessage({ type: 'renderPage', payload: { page: 1.5 } }), false);
    assert.equal(acceptsWebviewMessage({ type: 'renderPage', payload: { page: '1' } }), false);
  });

  it('messageを持つpreviewLoadFailedを受け入れ、message以外のkey・payloadの欠落・typeの空文字を拒否する', () => {
    assert.equal(acceptsWebviewMessage({ type: 'previewLoadFailed', payload: { message: 'failed' } }), true);
    assert.equal(
      acceptsWebviewMessage({ type: 'previewLoadFailed', payload: { message: 'failed', code: 'E_FAIL' } }),
      false,
    );
    assert.equal(acceptsWebviewMessage({ type: 'previewLoadFailed' }), false);
    assert.equal(acceptsWebviewMessage({ type: '' }), false);
  });

  it('unknown type・payload不足・余分なトップレベルキーを拒否する', () => {
    assert.equal(acceptsWebviewMessage({ type: 'unknown' }), false);
    assert.equal(acceptsWebviewMessage({ type: 'renderPage' }), false);
    assert.equal(acceptsWebviewMessage({ type: 'ready', requestId: 'request-1' }), false);
  });

  it('PDF initはpdfSrcと全PDF.js resourceを必須とし、TIFF initはpdfSrc/resource無しで受け入れる', () => {
    const pdfInit = {
      type: 'init',
      payload: {
        format: 'pdf',
        ...hostInitBase,
        pdfSrc: 'vscode-resource://sample.pdf',
        resources: hostPdfResources,
      },
    };
    assert.equal(acceptsHostMessage(pdfInit), true);

    const { pdfSrc: _unusedPdfSrc, ...pdfInitWithoutSource } = pdfInit.payload;
    assert.equal(
      acceptsHostMessage({ type: 'init', payload: { ...pdfInitWithoutSource, resources: hostPdfResources } }),
      false,
    );
    assert.equal(
      acceptsHostMessage({
        type: 'init',
        payload: { ...pdfInit.payload, resources: { workerSrc: 'vscode-resource://pdf.worker.mjs' } },
      }),
      false,
    );
    assert.equal(
      acceptsHostMessage({
        type: 'init',
        payload: { format: 'tiff', ...hostInitBase },
      }),
      true,
    );
    assert.equal(
      acceptsHostMessage({
        type: 'init',
        payload: { format: 'tiff', ...hostInitBase, pdfSrc: 'vscode-resource://sample.tiff' },
      }),
      false,
    );
  });
});
