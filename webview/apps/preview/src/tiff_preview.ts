export interface TiffRenderOptions {
  container: HTMLElement;
  pageCount: number;
  pageLabel?: string;
  zoom: () => number;
  requestPage: (page: number) => void;
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

/**
 * Renders a multi-page TIFF preview. The host renders each page to a PNG data
 * URI on demand; this client creates one frame per page, requests pages when
 * they scroll into view and applies the current preview zoom on load.
 */
export function renderTiffPreview(options: TiffRenderOptions): TiffRenderController {
  const frames: HTMLElement[] = [];
  const images: HTMLImageElement[] = [];
  const requested = new Set<number>();
  let disposed = false;
  const firstPageReady = createFirstPageReady();

  options.container.replaceChildren();
  for (let pageNumber = 1; pageNumber <= options.pageCount; pageNumber += 1) {
    const { frame, image } = createTiffPageFrame(options, pageNumber, firstPageReady.resolve);
    options.container.append(frame);
    frames.push(frame);
    images.push(image);
  }

  const requestPage = (pageNumber: number): void => {
    if (disposed || requested.has(pageNumber)) {
      return;
    }
    requested.add(pageNumber);
    options.requestPage(pageNumber);
  };

  const observer =
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

  for (const frame of frames) {
    observer?.observe(frame);
  }
  requestPage(1);

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
  };

  return {
    firstPageReady: firstPageReady.promise,
    setPageSrc(pageNumber, dataUri) {
      const image = images[pageNumber - 1];
      if (image === undefined) {
        return;
      }
      image.src = dataUri;
    },
    applyZoom() {
      for (const image of images) {
        if (image.naturalWidth > 0) {
          image.style.width = `${image.naturalWidth * options.zoom()}px`;
        }
      }
    },
    dispose: disposeController,
  };
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
