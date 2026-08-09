import assert from 'node:assert/strict';

import {
  isMergePdfHostToWebviewMessage,
  isMergePdfWebviewToHostMessage,
} from '../../src/shared/protocols/merge_pdf_protocol.js';

suite('Merge PDFのWebviewとホスト間で送受信するメッセージ形式の判定（init/apply/ready）', () => {
  test('2つ以上のsources（各sourceId/fileName/vscode-resource URI）とpreview・labelsを持つinitメッセージと、非空sourceIdsを持つapplyメッセージを受け入れ、requestId付きreadyと空typeを拒否する', () => {
    assert.equal(
      isMergePdfHostToWebviewMessage({
        type: 'init',
        payload: {
          sources: [
            { sourceId: 'source-1', fileName: 'first.pdf', pdfSrc: 'vscode-resource://first.pdf' },
            { sourceId: 'source-2', fileName: 'second.pdf', pdfSrc: 'vscode-resource://second.pdf' },
          ],
          resources: {
            workerSrc: 'vscode-resource://pdf.worker.mjs',
            cMapUrl: 'vscode-resource://cmaps/',
            standardFontDataUrl: 'vscode-resource://standard_fonts/',
            wasmUrl: 'vscode-resource://wasm/',
          },
          preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
          labels: {
            header: { title: 'Merge PDFs' },
            sources: { list: 'PDF files', count: 'files selected' },
            controls: {
              actions: 'Actions',
              dragHandle: 'Drag to reorder',
              moveUp: 'Move up',
              moveDown: 'Move down',
              removeSource: 'Remove from list',
            },
            preview: {
              title: 'Preview',
              ariaLabel: 'First page preview',
              loading: 'Loading',
              renderError: 'Unavailable',
            },
            actions: { apply: 'Merge', cancel: 'Cancel' },
          },
        },
      }),
      true,
    );
    assert.equal(
      isMergePdfWebviewToHostMessage({
        type: 'apply',
        payload: { sourceIds: ['source-2', 'source-1'] },
      }),
      true,
    );
    assert.equal(isMergePdfWebviewToHostMessage({ type: 'ready', requestId: 'request-1' }), false);
    assert.equal(isMergePdfWebviewToHostMessage({ type: '' }), false);
  });

  test('pdfSrcがvscode-resourceでないファイルシステムパスを持つinitと、sourceIds以外にpathsを持つapplyと、message以外のcodeを持つpreviewLoadFailedを拒否する', () => {
    assert.equal(
      isMergePdfHostToWebviewMessage({
        type: 'init',
        payload: {
          sources: [
            { sourceId: 'source-1', fileName: 'first.pdf', pdfSrc: '/workspace/first.pdf' },
            { sourceId: 'source-2', fileName: 'second.pdf', pdfSrc: 'vscode-resource://second.pdf' },
          ],
          labels: {
            header: { title: 'Merge PDFs' },
            sources: { list: 'PDF files', count: 'files selected' },
            controls: {
              actions: 'Actions',
              dragHandle: 'Drag to reorder',
              moveUp: 'Move up',
              moveDown: 'Move down',
              removeSource: 'Remove from list',
            },
            preview: {
              title: 'Preview',
              ariaLabel: 'First page preview',
              loading: 'Loading',
              renderError: 'Unavailable',
            },
            actions: { apply: 'Merge', cancel: 'Cancel' },
          },
        },
      }),
      false,
    );
    assert.equal(
      isMergePdfWebviewToHostMessage({
        type: 'apply',
        payload: { sourceIds: ['source-1', 'source-2'], paths: ['/workspace/first.pdf'] },
      }),
      false,
    );
    assert.equal(
      isMergePdfWebviewToHostMessage({
        type: 'previewLoadFailed',
        payload: { message: 'preview failed', code: 'E_FAIL' },
      }),
      false,
    );
  });
});
