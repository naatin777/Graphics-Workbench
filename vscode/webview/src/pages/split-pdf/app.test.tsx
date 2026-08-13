import { render } from 'solid-js/web';

import { createTestPageHost } from '../../test_support/mock_page_host';
import { splitPdfProtocol } from '@graphics-workbench/vscode-protocol/split-pdf-protocol';
import type { ExtensionToWebviewMessage, SplitPdfLabels } from './messages';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderPdfPages = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock('./vscode', () => ({
  vscode: createTestPageHost(splitPdfProtocol, sendMessage),
}));
vi.mock('@webview-shared/pdf/render_pdf_pages', () => ({ renderPdfPages }));

const labels: SplitPdfLabels = {
  header: {
    title: 'Split PDF',
    description: 'Select pages and assign an output name to each group.',
  },
  preview: {
    title: 'Preview',
    ariaLabel: 'PDF preview',
    renderError: 'Could not display the PDF',
    applyError: 'PDF preview must render before applying.',
    allPages: 'All pages',
    focusedPages: 'Focused',
    zoom: 'Preview zoom',
  },
  groups: {
    title: 'Groups',
    label: 'Group',
    add: 'Add group',
    remove: 'Remove group',
    drag: 'Drag group',
    outputOrder: 'Output order',
  },
  pages: {
    title: 'Pages',
    label: 'Page',
    placeholder: 'Example: 1, 3-6, 10-',
  },
  output: {
    name: 'Output name',
    namePlaceholder: 'group-1',
    path: 'Output path',
  },
  validation: {
    pagesRequired: 'At least one page must be selected.',
    pageWholeNumber: 'Page must be a whole number: {0}',
    pageOutOfRange: 'Selected page is out of range: {0}',
    invalidPages: 'Invalid page expression: {0}',
    descendingPages: 'Page range must ascend: {0}',
    outputNameEmpty: 'Output name cannot be empty.',
    outputNamePath: 'Output name must not contain path separators or .. .',
    outputNameDuplicate: 'Output name is duplicated: {0}',
  },
  actions: {
    apply: 'Apply',
    cancel: 'Cancel',
    moveUp: 'Move up',
    moveDown: 'Move down',
  },
};

const initMessage: ExtensionToWebviewMessage = {
  type: 'init',
  payload: {
    sourceId: 'source-1',
    fileName: 'source.pdf',
    pageCount: 4,
    pdfSrc: 'vscode-resource://source.pdf',
    outputPathTemplate: 'output/__GRAPHICS_WORKBENCH_OUTPUT_NAME__.pdf',
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

describe('Split PDF Webview', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessage.mockReset();
    renderPdfPages.mockImplementation(async (_src: unknown, container: unknown) => {
      if (!(container instanceof HTMLElement)) {
        throw new Error('Preview container was not rendered.');
      }
      for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
        const frame = document.createElement('figure');
        frame.className = 'pdf-page';
        frame.dataset.pdfPage = pageNumber.toString();
        const canvas = document.createElement('canvas');
        canvas.dataset.pdfPage = pageNumber.toString();
        canvas.dataset.pdfWidth = '600';
        canvas.dataset.pdfHeight = '800';
        frame.append(canvas);
        container.append(frame);
      }
      return { firstPageReady: Promise.resolve(), dispose: vi.fn<() => void>() };
    });
    const root = document.querySelector('#root');

    if (!root) {
      throw new Error('Test root was not created.');
    }

    dispose = render(() => <App />, root);
    globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  });

  afterEach(() => {
    dispose?.();
    document.body.innerHTML = '';
  });

  test('shows page errors and adds a row on Enter after valid input', async () => {
    await flushPromises();

    const pages = findInput('Pages 1');
    setInput(pages, '3-1');
    await flushPromises();
    dispatchEnter(findInput('Pages 1'));
    await flushPromises();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Page range must ascend');

    setInput(findInput('Pages 1'), '1-2');
    await flushPromises();
    dispatchEnter(findInput('Pages 1'));
    await flushPromises();

    expect(document.querySelector('input[aria-label="Pages 2"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('input[aria-label="Pages 2"]'));
  });

  test('keeps the edited group input focused while its value changes', async () => {
    await flushPromises();

    const pages = findInput('Pages 1');
    pages.focus();
    setInput(pages, '1');
    await flushPromises();

    expect(document.activeElement).toBe(pages);
  });

  test('toggles all-page preview, changes zoom, and applies groups', async () => {
    await flushPromises();
    sendMessage.mockClear();

    const pages = findInput('Pages 1');
    setInput(pages, '1-2');
    const [, allPagesButton] = document.querySelectorAll<HTMLButtonElement>('.segmented__button');
    allPagesButton?.click();
    expect(allPagesButton?.getAttribute('aria-pressed')).toBe('true');

    const zoom = document.querySelector<HTMLInputElement>('input[type="number"][aria-label="Preview zoom"]');
    if (!zoom) {
      throw new Error('Preview zoom input was not rendered.');
    }

    setInput(zoom, '200');
    expect(zoom.value).toBe('200');
    document.querySelector<HTMLButtonElement>('button.button--primary')?.click();
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'apply',
      payload: { rows: [{ pages: [1, 2], outputName: '1-2' }] },
    });
  });

  test('tracks the current page and scrolls via the page navigator', async () => {
    await flushPromises();
    await nextFrame();

    const pages = [...document.querySelectorAll<HTMLElement>('.pdf-page')];
    expect(pages).toHaveLength(4);
    const [page1, page2] = pages;
    if (!page1 || !page2) {
      throw new Error('Preview pages were not rendered.');
    }

    const preview = document.querySelector<HTMLElement>('.pdf-preview');
    if (!preview) {
      throw new Error('PDF preview was not rendered.');
    }
    mockLayout(preview, { top: 0, bottom: 100, width: 800 });
    mockLayout(page1, { top: 0, bottom: 80, width: 100 });
    mockLayout(page2, { top: 80, bottom: 160, width: 100 });

    setInput(findInput('Pages 1'), '1-2');
    await flushPromises();
    await nextFrame();

    expect(page1.dataset.current).toBe('true');
    expect(page2.dataset.current).toBeUndefined();
    expect(document.querySelector('.page-navigator__position')?.textContent).toBe('1 / 4');

    const scrollIntoView = vi.fn();
    page2.scrollIntoView = scrollIntoView;
    const previous = document.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]');
    const next = document.querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    if (!previous || !next) {
      throw new Error('Page navigator buttons were not rendered.');
    }

    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    next.click();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test('switching preview mode re-derives the current page from visible pages', async () => {
    await flushPromises();
    await nextFrame();

    const pages = [...document.querySelectorAll<HTMLElement>('.pdf-page')];
    const [page1, page2, page3, page4] = pages;
    if (!page1 || !page2 || !page3 || !page4) {
      throw new Error('Preview pages were not rendered.');
    }
    const preview = document.querySelector<HTMLElement>('.pdf-preview');
    if (!preview) {
      throw new Error('PDF preview was not rendered.');
    }
    mockLayout(preview, { top: 0, bottom: 100, width: 800 });
    mockLayout(page1, { top: 0, bottom: 80, width: 100 });
    mockLayout(page2, { top: 80, bottom: 160, width: 100 });
    mockLayout(page3, { top: 160, bottom: 240, width: 100 });
    mockLayout(page4, { top: 240, bottom: 320, width: 100 });

    setInput(findInput('Pages 1'), '2-3');
    await flushPromises();
    await nextFrame();
    expect(document.querySelector('.page-navigator__position')?.textContent).toBe('2 / 4');
    expect(page2.dataset.current).toBe('true');

    document.querySelector<HTMLButtonElement>('.segmented__button[aria-pressed="false"]')?.click();
    await flushPromises();
    await nextFrame();
    expect(document.querySelector('.page-navigator__position')?.textContent).toBe('1 / 4');
    expect(page1.dataset.current).toBe('true');
    expect(page2.dataset.current).toBeUndefined();
  });

  test('dragging the split divider resizes the preview pane', async () => {
    await flushPromises();

    const divider = document.querySelector('.split-pane__divider');
    const leftPane = document.querySelector<HTMLElement>('.split-pane__left');

    if (!divider || !leftPane) {
      throw new Error('Split pane was not rendered.');
    }

    const container = document.querySelector('.split-pane');
    if (!container) {
      throw new Error('Split pane container was not rendered.');
    }
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      left: 0,
      right: 800,
      top: 0,
      bottom: 0,
      x: 0,
      y: 0,
      height: 0,
      toJSON: () => ({}),
    });

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100 }));
    globalThis.dispatchEvent(new PointerEvent('pointermove', { clientX: 300 }));
    globalThis.dispatchEvent(new PointerEvent('pointerup'));

    expect(leftPane.style.flex).toBe('0 0 300px');
  });
});

function findInput(label: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

  if (!input) {
    throw new Error(`${label} input was not rendered.`);
  }

  return input;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function dispatchEnter(input: HTMLInputElement): void {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'key', { value: 'Enter' });
  input.focus();
  input.dispatchEvent(event);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function mockLayout(element: HTMLElement, layout: { top: number; bottom: number; width: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: layout.top,
    bottom: layout.bottom,
    left: 0,
    right: layout.width,
    x: 0,
    y: layout.top,
    width: layout.width,
    height: layout.bottom - layout.top,
    toJSON: () => ({}),
  });
}
