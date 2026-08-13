import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

import { createPdfPreview, type PdfPreview, type PdfPreviewRenderOptions } from './create_pdf_preview';

const renderPdfPages = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock('./render_pdf_pages', () => ({ renderPdfPages }));

interface PreviewHarness {
  preview: PdfPreview;
  pages: () => HTMLDivElement | undefined;
  scroll: () => HTMLDivElement | undefined;
}

interface PreviewOptions {
  pageCount?: () => number;
  setRenderError: (message: string) => void;
  onRenderError: (message: string) => void;
}

function MountPreview(properties: {
  options: PreviewOptions;
  onReady: (harness: PreviewHarness) => void;
}): JSX.Element {
  let pages: HTMLDivElement | undefined;
  let scroll: HTMLDivElement | undefined;
  const preview = createPdfPreview({
    pagesContainer: () => pages,
    scrollContainer: () => scroll,
    ...(properties.options.pageCount === undefined ? {} : { pageCount: properties.options.pageCount }),
    setRenderError: properties.options.setRenderError,
    onRenderError: properties.options.onRenderError,
  });
  properties.onReady({ preview, pages: () => pages, scroll: () => scroll });
  return (
    <div ref={(element) => (scroll = element)}>
      <div ref={(element) => (pages = element)} />
    </div>
  );
}

function mountPreview(options: PreviewOptions): { dispose: () => void; harness: PreviewHarness } {
  const root = document.querySelector('#root');
  if (!root) {
    throw new Error('Test root was not created.');
  }
  let harness: PreviewHarness | undefined;
  const dispose = render(
    () => (
      <MountPreview
        options={options}
        onReady={(value) => (harness = value)}
      />
    ),
    root,
  );
  if (!harness) {
    throw new Error('Preview harness was not mounted.');
  }
  return { dispose, harness };
}

function renderResources(): PdfPreviewRenderOptions {
  return {
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    resources: {
      workerSrc: 'vscode-resource://pdf.worker.mjs',
      cMapUrl: 'vscode-resource://cmaps/',
      standardFontDataUrl: 'vscode-resource://standard_fonts/',
      wasmUrl: 'vscode-resource://wasm/',
    },
  };
}

function getRenderOptions(callIndex: number): unknown {
  return renderPdfPages.mock.calls[callIndex]?.[2];
}

function getAbortSignal(value: unknown): AbortSignal | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const signal = Reflect.get(value, 'signal');
  return signal instanceof AbortSignal ? signal : undefined;
}

function getOnRenderError(value: unknown): ((error: unknown) => void) | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const onRenderError = Reflect.get(value, 'onRenderError');
  return typeof onRenderError === 'function' ? (onRenderError as (error: unknown) => void) : undefined;
}

function appendPage(pages: HTMLDivElement, pageNumber: number): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'pdf-page';
  figure.dataset.pdfPage = String(pageNumber);
  pages.append(figure);
  return figure;
}

function mockRect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    x: 0,
    y: top,
    width: 100,
    height,
    toJSON: () => ({}),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createPdfPreview', () => {
  let setRenderError: ReturnType<typeof vi.fn<(message: string) => void>>;
  let onRenderError: ReturnType<typeof vi.fn<(message: string) => void>>;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    setRenderError = vi.fn<(message: string) => void>();
    onRenderError = vi.fn<(message: string) => void>();
    renderPdfPages.mockReset();
    renderPdfPages.mockResolvedValue({ firstPageReady: Promise.resolve(), dispose: vi.fn(async () => undefined) });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = '';
  });

  const mount = (options: PreviewOptions): PreviewHarness => {
    const mounted = mountPreview(options);
    cleanup = mounted.dispose;
    return mounted.harness;
  };

  test('disposes the previous render controller and aborts its signal when start runs again', async () => {
    const disposePrevious = vi.fn(async () => undefined);
    const disposeNext = vi.fn(async () => undefined);
    renderPdfPages
      .mockResolvedValueOnce({ firstPageReady: Promise.resolve(), dispose: disposePrevious })
      .mockResolvedValueOnce({ firstPageReady: Promise.resolve(), dispose: disposeNext });
    const harness = mount({ setRenderError, onRenderError });

    await harness.preview.start('pdf://source', renderResources());
    const previousSignal = getAbortSignal(getRenderOptions(0));
    expect(previousSignal?.aborted).toBe(false);
    expect(renderPdfPages).toHaveBeenCalledTimes(1);

    await harness.preview.start('pdf://source', renderResources());
    expect(renderPdfPages).toHaveBeenCalledTimes(2);
    expect(previousSignal?.aborted).toBe(true);
    expect(disposePrevious).toHaveBeenCalledTimes(1);
    expect(disposeNext).not.toHaveBeenCalled();
  });

  test('ignores stale generations that complete after a newer start', async () => {
    let resolveFirstPage: (() => void) | undefined;
    const staleFirstPageReady = new Promise<void>((resolve) => (resolveFirstPage = resolve));
    const disposeStale = vi.fn(async () => undefined);
    renderPdfPages
      .mockResolvedValueOnce({ firstPageReady: staleFirstPageReady, dispose: disposeStale })
      .mockResolvedValueOnce({ firstPageReady: Promise.resolve(), dispose: vi.fn(async () => undefined) });
    const harness = mount({ setRenderError, onRenderError });
    const staleAfterFirstPage = vi.fn();
    const currentAfterFirstPage = vi.fn();

    const staleStart = harness.preview.start('pdf://source', renderResources(), staleAfterFirstPage);
    await flushPromises();
    const currentStart = harness.preview.start('pdf://source', renderResources(), currentAfterFirstPage);
    await flushPromises();

    expect(disposeStale).toHaveBeenCalledTimes(1);
    resolveFirstPage?.();
    await Promise.all([staleStart, currentStart]);

    expect(staleAfterFirstPage).not.toHaveBeenCalled();
    expect(currentAfterFirstPage).toHaveBeenCalledTimes(1);
    expect(setRenderError).not.toHaveBeenCalled();
  });

  test('reports a failed start through setRenderError and onRenderError', async () => {
    renderPdfPages.mockRejectedValueOnce(new Error('render exploded'));
    const harness = mount({ setRenderError, onRenderError });

    await harness.preview.start('pdf://source', renderResources());

    expect(setRenderError).toHaveBeenCalledWith('render exploded');
    expect(onRenderError).toHaveBeenCalledWith('render exploded');
  });

  test('reports page render errors through setRenderError and onRenderError', async () => {
    const harness = mount({ setRenderError, onRenderError });

    await harness.preview.start('pdf://source', renderResources());

    const reportError = getOnRenderError(getRenderOptions(0));
    expect(reportError).toBeDefined();
    reportError?.(new Error('page 3 exploded'));
    expect(setRenderError).toHaveBeenCalledWith('page 3 exploded');
    expect(onRenderError).toHaveBeenCalledWith('page 3 exploded');
  });

  test('ignores page render errors after the render was aborted', async () => {
    const harness = mount({ setRenderError, onRenderError });

    await harness.preview.start('pdf://source', renderResources());
    await harness.preview.start('pdf://source', renderResources());

    const reportError = getOnRenderError(getRenderOptions(0));
    reportError?.(new Error('stale page exploded'));
    expect(setRenderError).not.toHaveBeenCalled();
    expect(onRenderError).not.toHaveBeenCalled();
  });

  test('waits for the first page before running afterFirstPage', async () => {
    let resolveFirstPage: (() => void) | undefined;
    const firstPageReady = new Promise<void>((resolve) => (resolveFirstPage = resolve));
    renderPdfPages.mockResolvedValueOnce({ firstPageReady, dispose: vi.fn(async () => undefined) });
    const harness = mount({ setRenderError, onRenderError });
    const afterFirstPage = vi.fn();

    const start = harness.preview.start('pdf://source', renderResources(), afterFirstPage);
    await flushPromises();
    expect(afterFirstPage).not.toHaveBeenCalled();

    resolveFirstPage?.();
    await start;
    expect(afterFirstPage).toHaveBeenCalledTimes(1);
  });

  test('aborts the render signal and disposes the controller on unmount', async () => {
    const dispose = vi.fn(async () => undefined);
    renderPdfPages.mockResolvedValueOnce({ firstPageReady: Promise.resolve(), dispose });
    const harness = mount({ setRenderError, onRenderError });

    await harness.preview.start('pdf://source', renderResources());
    const signal = getAbortSignal(getRenderOptions(0));

    cleanup?.();
    cleanup = undefined;

    expect(signal?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('tracks the current page, syncs the outline, and navigates with the page count clamp', () => {
    const harness = mount({ pageCount: () => 3, setRenderError, onRenderError });
    const pages = harness.pages();
    const scroll = harness.scroll();
    if (!pages || !scroll) {
      throw new Error('Preview containers were not rendered.');
    }
    const page1 = appendPage(pages, 1);
    const page2 = appendPage(pages, 2);
    const page3 = appendPage(pages, 3);
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(mockRect(0, 100));
    vi.spyOn(page1, 'getBoundingClientRect').mockReturnValue(mockRect(0, 100));
    vi.spyOn(page2, 'getBoundingClientRect').mockReturnValue(mockRect(100, 100));
    vi.spyOn(page3, 'getBoundingClientRect').mockReturnValue(mockRect(200, 100));

    harness.preview.recomputeCurrentPage();
    expect(harness.preview.currentPage()).toBe(1);
    expect(page1.dataset.current).toBe('true');
    expect(page2.dataset.current).toBeUndefined();

    const scrollIntoView = vi.fn();
    page2.scrollIntoView = scrollIntoView;
    harness.preview.goToNextPage();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    const page1Scroll = vi.fn();
    page1.scrollIntoView = page1Scroll;
    harness.preview.goToPreviousPage();
    expect(page1Scroll).toHaveBeenCalledTimes(1);
  });
});
