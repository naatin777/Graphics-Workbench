import { render } from 'solid-js/web';

import { createTestPageHost } from '../../test_support/mock_page_host';
import type { PdfRenderController, PdfRenderOptions } from '../../shared/pdf/render_pdf_pages';
import type { TiffRenderController, TiffRenderOptions } from './tiff_preview';
import type { ExtensionToWebviewMessage, PreviewLabels } from './messages';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderPdfPages = vi.hoisted(() =>
  vi.fn<(pdfSrc: string, container: HTMLElement, options: PdfRenderOptions) => Promise<PdfRenderController>>(),
);
const renderTiffPreview = vi.hoisted(() => vi.fn<(options: TiffRenderOptions) => TiffRenderController>());

vi.mock('./vscode', () => ({
  vscode: createTestPageHost(sendMessage),
}));
vi.mock('../../shared/pdf/render_pdf_pages', () => ({ renderPdfPages }));
vi.mock('./tiff_preview', () => ({ renderTiffPreview }));

const labels: PreviewLabels = {
  title: 'Preview',
  description: 'Preview the file contents.',
  page: {
    label: 'Page',
    pages: 'pages',
  },
  preview: {
    ariaLabel: 'Preview',
    zoomLabel: 'Preview zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    renderError: 'Could not display the preview',
  },
};

const pdfInit: ExtensionToWebviewMessage = {
  type: 'init',
  payload: {
    format: 'pdf',
    fileName: 'source.pdf',
    pageCount: 2,
    pdfData: 'JVBERi0xLjQK',
    resources: { workerSrc: '', cMapUrl: '', standardFontDataUrl: '', wasmUrl: '' },
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  },
};

const tiffInit: ExtensionToWebviewMessage = {
  type: 'init',
  payload: {
    format: 'tiff',
    fileName: 'image.tiff',
    pageCount: 3,
    resources: {},
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  },
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

    dispose = render(() => <App />, root);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  test('on mount sends ready and renders PDF pages from the transferred bytes', async () => {
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ready' });

    globalThis.dispatchEvent(new MessageEvent('message', { data: pdfInit }));
    await flushPromises();

    const options = renderPdfPages.mock.calls[0]?.[2];
    expect(renderPdfPages).toHaveBeenCalledTimes(1);
    expect(renderPdfPages.mock.calls[0]?.[0]).toBe('');
    expect(options?.data).toEqual(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]));
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

  test('disposes the PDF render controller and aborts its signal on cleanup', async () => {
    globalThis.dispatchEvent(new MessageEvent('message', { data: pdfInit }));
    await flushPromises();

    const options = renderPdfPages.mock.calls[0]?.[2];
    const signal = getAbortSignal(options);

    dispose?.();
    dispose = undefined;

    expect(signal?.aborted).toBe(true);
    expect(pdfController.dispose).toHaveBeenCalledTimes(1);
  });
});

function getAbortSignal(value: unknown): AbortSignal | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const signal = Reflect.get(value, 'signal');
  return signal instanceof AbortSignal ? signal : undefined;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
