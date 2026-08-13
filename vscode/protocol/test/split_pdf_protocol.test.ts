import assert from 'node:assert/strict';

import { suite, test } from 'mocha';

import { splitPdfProtocol } from '@graphics-workbench/vscode-protocol/split-pdf-protocol';

const acceptsHostMessage = (value: unknown): boolean => splitPdfProtocol.parseHostToWebview(value) !== undefined;
const acceptsWebviewMessage = (value: unknown): boolean => splitPdfProtocol.parseWebviewToHost(value) !== undefined;

const labels = {
  'webview.splitPdf.title': 'Split PDF',
  'webview.splitPdf.description': 'Split pages into groups.',
  'webview.splitPdf.preview': 'Preview',
  'webview.splitPdf.previewAriaLabel': 'PDF preview',
  'webview.splitPdf.previewRenderError': 'Could not render the PDF.',
  'webview.splitPdf.previewApplyError': 'Preview must finish before applying.',
  'webview.splitPdf.allPages': 'All pages',
  'webview.splitPdf.focusedPages': 'Focused',
  'webview.splitPdf.zoom': 'Preview zoom',
  'webview.splitPdf.groups': 'Groups',
  'webview.splitPdf.groupLabel': 'Group',
  'webview.splitPdf.addGroup': 'Add group',
  'webview.splitPdf.removeGroup': 'Remove group',
  'webview.splitPdf.dragGroup': 'Drag group',
  'webview.splitPdf.outputOrder': 'Output order',
  'webview.splitPdf.pages': 'Pages',
  'webview.splitPdf.pageLabel': 'Page',
  'webview.splitPdf.pagesPlaceholder': '1, 3-5',
  'webview.splitPdf.outputName': 'Output name',
  'webview.splitPdf.outputNamePlaceholder': 'group-1.pdf',
  'webview.splitPdf.outputPath': 'Output path',
  'webview.splitPdf.pagesRequiredError': 'Pages are required.',
  'webview.splitPdf.pageWholeNumberError': 'Page must be a whole number.',
  'webview.splitPdf.pageOutOfRangeError': 'Page is out of range.',
  'webview.splitPdf.invalidPages': 'Invalid pages: {0}',
  'webview.splitPdf.descendingPages': 'Descending pages: {0}',
  'webview.splitPdf.outputNameEmpty': 'Output name is empty.',
  'webview.splitPdf.outputNamePath': 'Output name contains a path.',
  'webview.splitPdf.outputNameDuplicate': 'Output name is duplicated: {0}',
  'webview.splitPdf.apply': 'Apply',
  'webview.splitPdf.cancel': 'Cancel',
  'webview.splitPdf.moveUp': 'Move up',
  'webview.splitPdf.moveDown': 'Move down',
};

const initPayload = {
  sourceId: 'source-1',
  fileName: 'source.pdf',
  pageCount: 3,
  pdfSrc: 'vscode-resource://source.pdf',
  outputPathTemplate: 'source/__GRAPHICS_WORKBENCH_OUTPUT_NAME__.pdf',
  resources: {
    workerSrc: 'vscode-resource://worker.mjs',
    cMapUrl: 'vscode-resource://cmaps/',
    standardFontDataUrl: 'vscode-resource://fonts/',
    wasmUrl: 'vscode-resource://wasm/',
  },
  preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
  labels,
};

suite('Split PDFのWebviewとホスト間で送受信するメッセージ形式の判定（init/ready/previewLoadFailed/apply）', () => {
  test('必須フィールドをすべて持つinitメッセージと、ready/previewLoadFailed/非空ページ行を持つapplyメッセージを受け入れる', () => {
    assert.equal(acceptsHostMessage({ type: 'init', payload: initPayload }), true);
    assert.equal(acceptsWebviewMessage({ type: 'ready' }), true);
    assert.equal(acceptsWebviewMessage({ type: 'previewLoadFailed', payload: { message: 'preview failed' } }), true);
    assert.equal(
      acceptsWebviewMessage({ type: 'apply', payload: { rows: [{ pages: [2, 2], outputName: 'group.pdf' }] } }),
      true,
    );
  });

  test('定義外キー・不正型・空ページ行・requestId付きready・空typeを持つメッセージを拒否する', () => {
    assert.equal(acceptsHostMessage({ type: 'init', payload: { ...initPayload, sourcePath: '/not-allowed' } }), false);
    assert.equal(acceptsWebviewMessage({ type: 'ready', requestId: 'request-1' }), false);
    assert.equal(acceptsWebviewMessage({ type: 'ready', payload: undefined }), false);
    assert.equal(
      acceptsWebviewMessage({ type: 'previewLoadFailed', payload: { message: 'preview failed', code: 'E_FAIL' } }),
      false,
    );
    assert.equal(
      acceptsWebviewMessage({ type: 'apply', payload: { rows: [{ pages: [], outputName: 'group.pdf' }] } }),
      false,
    );
    assert.equal(
      acceptsWebviewMessage({
        type: 'apply',
        payload: { rows: [{ pages: [1], outputName: 'group.pdf' }], sourcePath: '/not-allowed' },
      }),
      false,
    );
    assert.equal(acceptsWebviewMessage({ type: '' }), false);
  });
});
