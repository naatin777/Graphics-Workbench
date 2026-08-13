import { render } from 'solid-js/web';

import { createTestPageHost } from '../../test_support/mock_page_host';
import {
  cropPdfProtocol,
  type CropConfigureHostToWebview,
} from '@graphics-workbench/vscode-protocol/crop-pdf-protocol';
import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderPdfPages = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock('../../shared/pdf/render_pdf_pages', () => ({ renderPdfPages }));

const labels: MessageCatalog = {
  'webview.cropPdf.title': 'Custom Crop',
  'webview.cropPdf.description': 'Adjust the PDF crop area.',
  'webview.cropPdf.pageLabel': 'Page',
  'webview.cropPdf.pages': 'Pages',
  'webview.cropPdf.preview': 'Preview',
  'webview.cropPdf.previewAriaLabel': 'PDF preview',
  'webview.cropPdf.previewZoom': 'Preview zoom',
  'webview.cropPdf.zoomOut': 'Zoom out',
  'webview.cropPdf.zoomIn': 'Zoom in',
  'webview.cropPdf.previewRenderError': 'Could not display the PDF',
  'webview.cropPdf.previewApplyError': 'PDF preview must render before applying.',
  'webview.cropPdf.cropSettings': 'Crop settings',
  'webview.cropPdf.cropBox': 'Crop box',
  'webview.cropPdf.left': 'Left',
  'webview.cropPdf.bottom': 'Bottom',
  'webview.cropPdf.right': 'Right',
  'webview.cropPdf.top': 'Top',
  'webview.cropPdf.currentPageSize': 'Page size',
  'webview.cropPdf.applyTo': 'Apply to',
  'webview.cropPdf.allPages': 'All pages',
  'webview.cropPdf.pagesInput': 'Pages',
  'webview.cropPdf.pagesPlaceholder': '1, 3–5',
  'webview.cropPdf.cropBoxNumberError': '{0} must be a number.',
  'webview.cropPdf.cropBoxSizeError': 'Crop box must have positive width and height.',
  'webview.cropPdf.pagesRequiredError': 'At least one page must be selected.',
  'webview.cropPdf.pageWholeNumberError': 'Page must be a whole number: {0}',
  'webview.cropPdf.pageOutOfRangeError': 'Selected page is out of range: {0}',
  'webview.cropPdf.apply': 'Apply',
  'webview.cropPdf.processing': 'Processing…',
  'webview.cropPdf.cancel': 'Cancel',
};

const initMessage: CropConfigureHostToWebview = {
  type: 'init',
  payload: {
    fileName: 'source.pdf',
    pageCount: 2,
    initialPage: 1,
    pageGeometry: [
      {
        page: 1,
        mediaBox: { x: 0, y: 0, width: 600, height: 800 },
        cropBox: { x: 0, y: 0, width: 600, height: 800 },
        rotation: 0,
      },
      {
        page: 2,
        mediaBox: { x: 0, y: 0, width: 600, height: 800 },
        cropBox: { x: 0, y: 0, width: 600, height: 800 },
        rotation: 0,
      },
    ],
    initialCropBox: { left: 0, bottom: 0, right: 600, top: 800 },
    pdfSrc: 'vscode-resource://source.pdf',
    resources: {
      workerSrc: 'vscode-resource://pdf.worker.mjs',
      cMapUrl: 'vscode-resource://cmaps/',
      standardFontDataUrl: 'vscode-resource://standard_fonts/',
      wasmUrl: 'vscode-resource://wasm/',
    },
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  },
};

describe('Crop PDF Webview', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessage.mockReset();
    renderPdfPages.mockResolvedValue({ firstPageReady: Promise.resolve(), dispose: vi.fn<() => void>() });
    const root = document.querySelector('#root');

    if (!root) {
      throw new Error('Test root was not created.');
    }

    const pageHost = createTestPageHost(cropPdfProtocol, sendMessage);
    dispose = render(() => <App host={pageHost} />, root);
    globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  });

  afterEach(() => {
    dispose?.();
    document.body.innerHTML = '';
  });

  test('shows input errors, toggles selected pages, and applies the target', async () => {
    await flushPromises();
    sendMessage.mockClear();

    const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1]?.click();

    const selectedPages = document.querySelector<HTMLInputElement>('input[type="text"]');
    if (!selectedPages) {
      throw new Error('Selected pages input was not rendered.');
    }

    expect(selectedPages.disabled).toBe(false);
    setInput(selectedPages, '2');

    const left = findNumberInput('Left');
    setInput(left, '1000');
    document.querySelector<HTMLButtonElement>('button.button--primary')?.click();
    await flushPromises();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('positive width and height');
    expect(sendMessage).not.toHaveBeenCalledWith({
      type: 'apply',
      payload: { cropBox: expect.anything(), target: expect.anything() },
    });

    setInput(left, '0');
    document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click();
    expect(document.querySelector('.zoom__value')?.textContent).toBe('125%');
    document.querySelector<HTMLButtonElement>('button.button--primary')?.click();
    await flushPromises();

    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'apply',
      payload: {
        cropBox: { left: 0, bottom: 0, right: 600, top: 800 },
        target: { type: 'selected', pages: [2] },
      },
    });
    const applyButton = document.querySelector<HTMLButtonElement>('button.button--primary');
    expect(applyButton?.disabled).toBe(true);
    expect(applyButton?.textContent).toContain('Processing');
    expect(findNumberInput('Left').disabled).toBe(true);
    expect(selectedPages.disabled).toBe(true);

    globalThis.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'error', payload: { message: 'crop failed' } } satisfies CropConfigureHostToWebview,
      }),
    );
    await flushPromises();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('crop failed');
    expect(document.querySelector<HTMLButtonElement>('button.button--primary')?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('button.button--primary')?.textContent).toContain('Apply');
  });

  test('keeps the crop input focused while its value changes', async () => {
    await flushPromises();

    const left = findNumberInput('Left');
    left.focus();
    setInput(left, '1');
    await flushPromises();

    expect(document.activeElement).toBe(left);
  });
});

function findNumberInput(label: string): HTMLInputElement {
  const field = [...document.querySelectorAll('label.field')].find(
    (candidate) => candidate.querySelector('.field__label')?.textContent === label,
  );
  const input = field?.querySelector('input');

  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`${label} input was not rendered.`);
  }

  return input;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
