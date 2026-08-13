import { render } from 'solid-js/web';

import { createTestPageHost } from '../../test_support/mock_page_host';
import { previewProtocol, type PreviewHostToWebview } from '@graphics-workbench/vscode-protocol/preview-protocol';
import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';
import type { PdfRenderController, PdfRenderOptions } from '../../shared/pdf/render_pdf_pages';
import type { TiffRenderController, TiffRenderOptions } from './tiff_preview';
import { App, type PreviewInitPayload } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderPdfPages = vi.hoisted(() =>
  vi.fn<(pdfSrc: string, container: HTMLElement, options: PdfRenderOptions) => Promise<PdfRenderController>>(),
);
const renderTiffPreview = vi.hoisted(() => vi.fn<(options: TiffRenderOptions) => TiffRenderController>());

vi.mock('../../shared/pdf/render_pdf_pages', () => ({ renderPdfPages }));
vi.mock('./tiff_preview', () => ({ renderTiffPreview }));

const labels: MessageCatalog = {
  'webview.preview.title': 'Preview',
  'webview.preview.description': 'Preview the file contents.',
  'webview.preview.pageLabel': 'Page',
  'webview.preview.pages': 'pages',
  'webview.preview.previewAriaLabel': 'Preview',
  'webview.preview.zoomLabel': 'Preview zoom',
  'webview.preview.zoomOut': 'Zoom out',
  'webview.preview.zoomIn': 'Zoom in',
  'webview.preview.renderError': 'Could not display the preview',
};

const pdfInitPayload = {
  format: 'pdf',
  fileName: 'source.pdf',
  pageCount: 2,
  pdfSrc: 'vscode-resource://source.pdf',
  resources: {
    workerSrc: 'vscode-resource://pdf.worker.mjs',
    cMapUrl: 'vscode-resource://cmaps/',
    standardFontDataUrl: 'vscode-resource://standard_fonts/',
    wasmUrl: 'vscode-resource://wasm/',
  },
  preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
  labels,
} satisfies PreviewInitPayload;

const pdfInit: PreviewHostToWebview = {
  type: 'init',
  payload: pdfInitPayload,
};

const tiffInitPayload = {
  format: 'tiff',
  fileName: 'image.tiff',
  pageCount: 3,
  preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
  labels,
} satisfies PreviewInitPayload;

const tiffInit: PreviewHostToWebview = {
  type: 'init',
  payload: tiffInitPayload,
};

describe('PDF/TIFF Preview Webview', () => {
  let dispose: (() => void) | undefined;
  let pdfController: PdfRenderController;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessage.mockReset();
    renderPdfPages.mockReset();
    renderTiffPreview.mockReset();
    pdfController = { firstPageReady: Promise.resolve(), dispose: vi.fn(async () => undefined) };
    renderPdfPages.mockResolvedValue(pdfController);
    renderTiffPreview.mockReturnValue({
      firstPageReady: Promise.resolve(),
      setPageSrc: vi.fn(),
      applyZoom: vi.fn(),
      dispose: vi.fn(),
    });
    const root = document.querySelector('#root');

    if (!root) {
      throw new Error('Test root was not created.');
    }

    const pageHost = createTestPageHost(previewProtocol, sendMessage);
    dispose = render(() => <App host={pageHost} />, root);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  test('on mount sends ready and renders PDF pages from the provided URL', async () => {
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ready' });

    globalThis.dispatchEvent(new MessageEvent('message', { data: pdfInit }));
    await flushPromises();

    const options = renderPdfPages.mock.calls[0]?.[2];
    expect(renderPdfPages).toHaveBeenCalledTimes(1);
    expect(renderPdfPages.mock.calls[0]?.[0]).toBe('vscode-resource://source.pdf');
    expect(options?.preview).toEqual({ maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 });
    expect(document.querySelector('.preview__toolbar h2')?.textContent).toBe('source.pdf');
    expect(document.querySelector('.page-navigator__position')?.textContent).toContain('2');
  });

  test('renders TIFF pages by requesting each page from the host and assigning the returned data URI', async () => {
    globalThis.dispatchEvent(new MessageEvent('message', { data: tiffInit }));
    await flushPromises();

    expect(renderTiffPreview).toHaveBeenCalledTimes(1);
    const options = renderTiffPreview.mock.calls[0]?.[0];
    if (!options) {
      throw new Error('renderTiffPreview was not called.');
    }
    expect(options.pageCount).toBe(3);

    options.requestPage(2);
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'renderPage', payload: { page: 2 } });

    const controller = renderTiffPreview.mock.results[0]?.value;
    globalThis.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'renderPageResult', payload: { page: 2, dataUri: 'data:image/png;base64,AAA=' } },
      }),
    );
    expect(controller.setPageSrc).toHaveBeenCalledWith(2, 'data:image/png;base64,AAA=');
    expect(document.querySelector('.page-navigator__position')?.textContent).toContain('3');
  });

  test('shows an error message for a host error and keeps the page count header', async () => {
    globalThis.dispatchEvent(new MessageEvent('message', { data: tiffInit }));
    await flushPromises();

    globalThis.dispatchEvent(
      new MessageEvent('message', { data: { type: 'error', payload: { message: 'render failed' } } }),
    );
    await flushPromises();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('render failed');
  });

  test('zooming applies the TIFF controller zoom and updates the zoom label', async () => {
    globalThis.dispatchEvent(new MessageEvent('message', { data: tiffInit }));
    await flushPromises();

    const controller = renderTiffPreview.mock.results[0]?.value;
    document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click();
    await flushPromises();

    expect(controller.applyZoom).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.zoom__value')?.textContent).toBe('125%');
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
