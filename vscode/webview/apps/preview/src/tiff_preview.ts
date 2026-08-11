import {
  calculatePageWindow,
  insertPageFrameInOrder,
  shouldUseWindowedRendering,
} from '../../../shared/pdf/page_window';

export interface TiffRenderOptions {
  container: HTMLElement;
  pageCount: number;
  pageLabel?: string;
  zoom: () => number;
  requestPage: (page: number) => void;
  // oxlint-disable-next-line typescript/no-restricted-types -- レンダリングエラー通知のコールバック。
  onRenderError: (error: unknown) => void;
  root?: Element;
  signal: AbortSignal;
}

export interface TiffRenderController {
  firstPageReady: Promise<void>;
  setPageSrc: (page: number, dataUri: string) => void;
  applyZoom: () => void;
  dispose: () => void;
}

const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/**
 * Renders a multi-page TIFF preview. The host renders each page to a PNG data
 * URI on demand; this client creates one frame per page, requests pages when
 * they scroll into view and applies the current preview zoom on load.
 */
export function renderTiffPreview(options: TiffRenderOptions): TiffRenderController {
  const frames = new Map<number, HTMLElement>();
  const images = new Map<number, HTMLImageElement>();
  const renderedData = new Map<number, string>();
  const objectUrls = new Map<number, string>();
  const requested = new Set<number>();
  let disposed = false;
  const firstPageReady = createFirstPageReady();

  const requestPage = (pageNumber: number): void => {
    if (disposed || requested.has(pageNumber)) {
      return;
    }
    const dataUri = renderedData.get(pageNumber);
    const image = images.get(pageNumber);
    if (dataUri !== undefined && image !== undefined) {
      assignPageImageData(pageNumber, dataUri);
      return;
    }
    requested.add(pageNumber);
    options.requestPage(pageNumber);
  };

  const createFrame = (pageNumber: number): void => {
    const { frame, image } = createTiffPageFrame(options, pageNumber, firstPageReady.resolve);
    frames.set(pageNumber, frame);
    images.set(pageNumber, image);
    const dataUri = renderedData.get(pageNumber);
    if (dataUri !== undefined) {
      assignPageImageData(pageNumber, dataUri);
    }
  };

  const windowed = shouldUseWindowedRendering(options.pageCount, true);
  let observer: IntersectionObserver | undefined;
  let pageWindow: HTMLElement | undefined;
  let topSpacer: HTMLElement | undefined;
  let bottomSpacer: HTMLElement | undefined;
  let removeScrollListener: (() => void) | undefined;
  let estimatedPageHeight = 400;
  let windowStart = 1;
  let windowEnd = options.pageCount;

  if (windowed) {
    pageWindow = options.container.ownerDocument.createElement('div');
    topSpacer = options.container.ownerDocument.createElement('div');
    bottomSpacer = options.container.ownerDocument.createElement('div');
    topSpacer.setAttribute('aria-hidden', 'true');
    bottomSpacer.setAttribute('aria-hidden', 'true');
    pageWindow.className = 'tiff-page-window';
    options.container.replaceChildren(topSpacer, pageWindow, bottomSpacer);
    options.container.style.display = 'block';
    pageWindow.style.display = 'grid';
    pageWindow.style.gap = '12px';
    pageWindow.style.justifyItems = 'center';

    const updateSpacers = (): void => {
      const stride = estimatedPageHeight + 12;
      topSpacer?.style.setProperty('height', `${Math.max(0, windowStart - 1) * stride}px`);
      bottomSpacer?.style.setProperty('height', `${Math.max(0, options.pageCount - windowEnd) * stride}px`);
    };

    const updateWindow = (): void => {
      if (disposed) {
        return;
      }
      const scrollTop = options.root?.scrollTop ?? 0;
      const viewportHeight = options.root?.clientHeight ?? estimatedPageHeight * 24;
      const range = calculatePageWindow(options.pageCount, scrollTop, viewportHeight, estimatedPageHeight);
      windowStart = range.start;
      windowEnd = range.end;

      for (const [pageNumber, frame] of frames) {
        if (pageNumber >= windowStart && pageNumber <= windowEnd) {
          continue;
        }
        frame.remove();
        revokePageObjectUrl(pageNumber);
        frames.delete(pageNumber);
        images.delete(pageNumber);
        renderedData.delete(pageNumber);
        requested.delete(pageNumber);
      }

      for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) {
        if (!frames.has(pageNumber)) {
          createFrame(pageNumber);
          const currentPageWindow = pageWindow;
          const frame = frames.get(pageNumber);
          if (currentPageWindow === undefined || frame === undefined) {
            throw new Error(`Could not create TIFF page ${pageNumber}.`);
          }
          insertPageFrameInOrder(currentPageWindow, frame);
        }
      }
      updateSpacers();
      for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) {
        requestPage(pageNumber);
      }
    };

    options.root?.addEventListener('scroll', updateWindow, { passive: true });
    removeScrollListener = (): void => options.root?.removeEventListener('scroll', updateWindow);
    updateWindow();
  } else {
    options.container.replaceChildren();
    for (let pageNumber = 1; pageNumber <= options.pageCount; pageNumber += 1) {
      createFrame(pageNumber);
      const frame = frames.get(pageNumber);
      if (frame === undefined) {
        throw new Error(`Could not create TIFF page ${pageNumber}.`);
      }
      options.container.append(frame);
    }

    observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) {
                  continue;
                }
                const pageNumber = entry.target instanceof HTMLElement ? Number(entry.target.dataset.pdfPage) : 0;
                if (Number.isInteger(pageNumber) && pageNumber >= 1) {
                  requestPage(pageNumber);
                }
              }
            },
            { root: options.root ?? null, rootMargin: '200px 0px' },
          );

    for (const frame of frames.values()) {
      observer?.observe(frame);
    }
    requestPage(1);
  }

  const abort = (): void => {
    disposeController();
  };
  options.signal.addEventListener('abort', abort, { once: true });

  const disposeController = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    options.signal.removeEventListener('abort', abort);
    observer?.disconnect();
    removeScrollListener?.();
    options.container.replaceChildren();
    options.container.style.removeProperty('display');
    for (const pageNumber of objectUrls.keys()) {
      revokePageObjectUrl(pageNumber);
    }
  };

  return {
    firstPageReady: firstPageReady.promise,
    setPageSrc(pageNumber, dataUri) {
      if (disposed) {
        return;
      }
      requested.delete(pageNumber);
      const image = images.get(pageNumber);
      if (image === undefined) {
        if (isPngDataUri(dataUri)) {
          renderedData.set(pageNumber, dataUri);
        } else {
          options.onRenderError(new Error(`Page ${pageNumber} returned an invalid PNG data URI.`));
        }
        return;
      }
      if (!assignPageImageData(pageNumber, dataUri)) {
        return;
      }
      renderedData.set(pageNumber, dataUri);
      if (pageNumber === 1) {
        const { naturalWidth, naturalHeight } = image;
        if (naturalWidth > 0) {
          estimatedPageHeight = naturalHeight || estimatedPageHeight;
        }
      }
    },
    applyZoom() {
      for (const image of images.values()) {
        if (image.naturalWidth > 0) {
          image.style.width = `${image.naturalWidth * options.zoom()}px`;
        }
      }
    },
    dispose: disposeController,
  };

  function assignPageImageData(pageNumber: number, dataUri: string): boolean {
    const image = images.get(pageNumber);
    if (image === undefined) {
      options.onRenderError(new Error(`Could not find TIFF page ${pageNumber}.`));
      return false;
    }
    const objectUrl = createPngObjectUrl(dataUri);
    if (objectUrl === undefined) {
      options.onRenderError(new Error(`Page ${pageNumber} returned an invalid PNG data URI.`));
      return false;
    }

    revokePageObjectUrl(pageNumber);
    objectUrls.set(pageNumber, objectUrl);
    image.src = objectUrl;
    return true;
  }

  function revokePageObjectUrl(pageNumber: number): void {
    const objectUrl = objectUrls.get(pageNumber);
    if (objectUrl === undefined) {
      return;
    }
    URL.revokeObjectURL(objectUrl);
    objectUrls.delete(pageNumber);
  }
}

function createTiffPageFrame(
  options: TiffRenderOptions,
  pageNumber: number,
  resolveFirstPage: (() => void) | undefined,
): { frame: HTMLElement; image: HTMLImageElement } {
  const frame = options.container.ownerDocument.createElement('figure');
  frame.className = 'preview-page tiff-page';
  frame.dataset.pdfPage = pageNumber.toString();

  const image = options.container.ownerDocument.createElement('img');
  image.className = 'preview-page__image';
  image.dataset.pdfPage = pageNumber.toString();
  image.alt = `${options.pageLabel ?? 'Page'} ${pageNumber}`;
  image.addEventListener('load', () => {
    if (image.naturalWidth > 0) {
      image.style.width = `${image.naturalWidth * options.zoom()}px`;
    }
    if (pageNumber === 1) {
      resolveFirstPage?.();
    }
  });
  image.addEventListener('error', () => {
    options.onRenderError(new Error(`${image.alt} could not be loaded.`));
  });

  frame.append(image);
  return { frame, image };
}

function createFirstPageReady(): { promise: Promise<void>; resolve: () => void } {
  const state: { resolve: (() => void) | undefined } = { resolve: undefined };
  const promise = new Promise<void>((resolve) => {
    state.resolve = resolve;
  });
  return {
    promise,
    resolve: () => {
      state.resolve?.();
    },
  };
}

function isPngDataUri(dataUri: string): boolean {
  const base64 = dataUri.startsWith(PNG_DATA_URI_PREFIX) ? dataUri.slice(PNG_DATA_URI_PREFIX.length) : '';
  return base64.length > 0 && base64.length % 4 === 0 && BASE64_PATTERN.test(base64);
}

function createPngObjectUrl(dataUri: string): string | undefined {
  if (!isPngDataUri(dataUri)) {
    return undefined;
  }

  try {
    const base64 = dataUri.slice(PNG_DATA_URI_PREFIX.length);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  } catch {
    return undefined;
  }
}
