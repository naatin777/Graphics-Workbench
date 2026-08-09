import { renderTiffPreview } from './tiff_preview';

const requestPage = vi.fn<(page: number) => void>();

function createController(options: Partial<Parameters<typeof renderTiffPreview>[0]> = {}) {
  const container = document.querySelector<HTMLDivElement>('#container');
  if (!container) {
    throw new Error('Test container was not created.');
  }
  const { signal } = new AbortController();
  const controller = renderTiffPreview({
    container,
    pageCount: 3,
    pageLabel: 'Page',
    zoom: () => 1,
    requestPage,
    onRenderError: vi.fn(),
    signal,
    ...options,
  });
  return { controller, container, signal };
}

describe('TIFF preview client', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="container"></div>';
    requestPage.mockReset();
  });

  test('creates one frame per page and requests page 1 immediately', () => {
    const { controller, container } = createController({ pageCount: 3 });

    expect(container.querySelectorAll('.preview-page')).toHaveLength(3);
    expect(container.querySelectorAll('.preview-page__image')).toHaveLength(3);
    expect(requestPage).toHaveBeenCalledWith(1);
    expect(requestPage).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  test('setPageSrc assigns the data URI to the requested page image', () => {
    const { controller, container } = createController();

    controller.setPageSrc(2, 'data:image/png;base64,AAA=');

    const image = container.querySelector<HTMLImageElement>('img[data-pdf-page="2"]');
    expect(image?.src).toBe('data:image/png;base64,AAA=');
  });

  test('applies the current zoom when a page image loads', () => {
    let zoom = 2;
    const { controller, container } = createController({ zoom: () => zoom });

    controller.setPageSrc(1, 'data:image/png;base64,AAA=');
    const image = container.querySelector<HTMLImageElement>('img[data-pdf-page="1"]');
    if (!image) {
      throw new Error('Page image was not created.');
    }
    Object.defineProperty(image, 'naturalWidth', { value: 100 });
    image.dispatchEvent(new Event('load'));

    expect(image.style.width).toBe('200px');

    zoom = 1.5;
    controller.applyZoom();
    expect(image.style.width).toBe('150px');
  });

  test('resolves firstPageReady when page 1 loads', async () => {
    const { controller, container } = createController({ pageCount: 2 });
    let resolved = false;
    void controller.firstPageReady.then(() => {
      resolved = true;
    });

    controller.setPageSrc(1, 'data:image/png;base64,AAA=');
    const image = container.querySelector<HTMLImageElement>('img[data-pdf-page="1"]');
    if (!image) {
      throw new Error('Page image was not created.');
    }
    Object.defineProperty(image, 'naturalWidth', { value: 100 });
    image.dispatchEvent(new Event('load'));
    await Promise.resolve();

    expect(resolved).toBe(true);
  });

  test('reports image load errors through onRenderError', () => {
    const onRenderError = vi.fn();
    const { controller, container } = createController({ onRenderError });

    controller.setPageSrc(1, 'broken');
    container.querySelector<HTMLImageElement>('img[data-pdf-page="1"]')?.dispatchEvent(new Event('error'));

    expect(onRenderError).toHaveBeenCalledTimes(1);
  });

  test('dispose removes the abort listener and ignores later page data', () => {
    const { signal } = new AbortController();
    const removeEventListener = vi.spyOn(signal, 'removeEventListener');
    const { controller } = createController({ signal });

    controller.dispose();

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(() => controller.setPageSrc(1, 'data:image/png;base64,AAA=')).not.toThrow();
    expect(requestPage).toHaveBeenCalledTimes(1);
  });

  test('observes every page frame so scrolled pages are requested', () => {
    const observedTargets: Element[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        observe = (target: Element): void => {
          observedTargets.push(target);
        };
        disconnect = vi.fn();
      },
    );

    const { controller } = createController({ pageCount: 2 });

    expect(observedTargets).toHaveLength(2);
    expect(
      observedTargets.map((target) => (target instanceof HTMLElement ? target.dataset.pdfPage : undefined)),
    ).toEqual(['1', '2']);
    expect(requestPage).toHaveBeenCalledWith(1);

    controller.dispose();
    vi.unstubAllGlobals();
  });
});
