import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import { toErrorMessage } from '../error';
import { scrollPageIntoView } from '../ui/PageNavigator';
import { renderPdfPages, type PdfRenderController, type PdfRenderOptions } from './render_pdf_pages';

const PAGE_ELEMENT_SELECTOR = '.pdf-page[data-pdf-page], .preview-page[data-pdf-page]';

export type PdfPreviewRenderOptions = Omit<PdfRenderOptions, 'signal' | 'onRenderError'>;

export interface PdfPreview {
  readonly start: (pdfSrc: string, options: PdfPreviewRenderOptions, afterFirstPage?: () => void) => Promise<void>;
  readonly dispose: () => void;
  readonly currentPage: () => number | undefined;
  readonly recomputeCurrentPage: () => void;
  readonly scrollPageIntoView: (page: number) => void;
  readonly goToPreviousPage: () => void;
  readonly goToNextPage: () => void;
}

export function createPdfPreview(options: {
  pagesContainer: () => HTMLElement | undefined;
  scrollContainer: () => HTMLElement | undefined;
  pageCount?: () => number;
  setRenderError: (message: string) => void;
  onRenderError: (message: string) => void;
}): PdfPreview {
  const [currentPage, setCurrentPage] = createSignal(0);
  let observer: IntersectionObserver | undefined;
  let lastScheduled: number | undefined;
  let connectedContainer: HTMLElement | undefined;
  let renderController: PdfRenderController | undefined;
  let renderAbortController: AbortController | undefined;
  let generation = 0;

  const getPageElements = (): HTMLElement[] => {
    const container = options.pagesContainer();
    return container === undefined ? [] : [...container.querySelectorAll<HTMLElement>(PAGE_ELEMENT_SELECTOR)];
  };

  const compute = (): void => {
    const container = options.scrollContainer();
    const pages = getPageElements();
    if (!container || pages.length === 0) {
      setCurrentPage(0);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const viewportTop = containerRect.top;
    const viewportBottom = containerRect.bottom;
    const viewportCenter = (viewportTop + viewportBottom) / 2;

    let bestPage = currentPage();
    let bestArea = -1;
    let bestCenterDistance = Number.POSITIVE_INFINITY;

    for (const page of pages) {
      if (page.hidden === true) {
        continue;
      }
      const rect = page.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, viewportTop);
      const visibleBottom = Math.min(rect.bottom, viewportBottom);
      const visibleHeight = Math.max(visibleBottom - visibleTop, 0);
      if (visibleHeight <= 0) {
        continue;
      }
      const area = visibleHeight * Math.max(rect.width, 1);

      const pageCenter = (rect.top + rect.bottom) / 2;
      const centerDistance = Math.abs(pageCenter - viewportCenter);

      const pageNumber = Number(page.dataset.pdfPage ?? 0);
      if (area > bestArea || (area === bestArea && centerDistance < bestCenterDistance)) {
        bestArea = area;
        bestCenterDistance = centerDistance;
        bestPage = pageNumber;
      }
    }

    const normalized = Math.max(bestPage, 0);
    setCurrentPage(normalized);
  };

  const scheduleCompute = (): void => {
    if (lastScheduled !== undefined) {
      cancelAnimationFrame(lastScheduled);
    }
    lastScheduled = requestAnimationFrame(() => {
      lastScheduled = undefined;
      compute();
    });
  };

  const disconnect = (): void => {
    observer?.disconnect();
    observer = undefined;
    connectedContainer?.removeEventListener('scroll', scheduleCompute);
    connectedContainer = undefined;
    window.removeEventListener('resize', scheduleCompute);
  };

  const connect = (): void => {
    const container = options.scrollContainer();
    if (!container || container === connectedContainer) {
      return;
    }

    disconnect();
    connectedContainer = container;

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        () => {
          scheduleCompute();
        },
        { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] },
      );
      for (const page of getPageElements()) {
        observer.observe(page);
      }
    }

    compute();
    container.addEventListener('scroll', scheduleCompute, { passive: true });
    window.addEventListener('resize', scheduleCompute);
  };

  const recompute = (): void => {
    connect();
    compute();
  };

  onMount(() => {
    connect();
  });

  onCleanup(() => {
    disconnect();
    if (lastScheduled !== undefined) {
      cancelAnimationFrame(lastScheduled);
      lastScheduled = undefined;
    }
  });

  createEffect(() => {
    const current = currentPage();
    for (const page of getPageElements()) {
      if (page.dataset.pdfPage === String(current)) {
        page.dataset.current = 'true';
      } else {
        delete page.dataset.current;
      }
    }
  });

  const findPageElement = (page: number): HTMLElement | undefined => {
    const container = options.pagesContainer();
    return container?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`) ?? undefined;
  };

  const dispose = (): void => {
    generation += 1;
    renderAbortController?.abort();
    void renderController?.dispose();
    renderController = undefined;
  };

  onCleanup(() => {
    dispose();
  });

  const start = async (
    pdfSrc: string,
    renderOptions: PdfPreviewRenderOptions,
    afterFirstPage?: () => void,
  ): Promise<void> => {
    const container = options.pagesContainer();
    if (container === undefined) {
      return;
    }

    const currentGeneration = generation + 1;
    generation = currentGeneration;
    renderAbortController?.abort();
    void renderController?.dispose();
    renderController = undefined;
    const abortController = new AbortController();
    renderAbortController = abortController;
    const { signal } = abortController;

    try {
      const controller = await renderPdfPages(pdfSrc, container, {
        ...renderOptions,
        signal,
        onRenderError: (error) => {
          if (signal.aborted) {
            return;
          }
          const message = toErrorMessage(error);
          options.setRenderError(message);
          options.onRenderError(message);
        },
      });
      if (signal.aborted || currentGeneration !== generation) {
        await controller.dispose();
        return;
      }
      renderController = controller;
      await controller.firstPageReady;
      if (currentGeneration !== generation || signal.aborted) {
        return;
      }
      afterFirstPage?.();
      requestAnimationFrame(() => {
        recompute();
      });
    } catch (error) {
      if (signal.aborted || currentGeneration !== generation) {
        return;
      }
      const message = toErrorMessage(error);
      options.setRenderError(message);
      options.onRenderError(message);
    }
  };

  return {
    start,
    dispose,
    currentPage: () => {
      const page = currentPage();
      return page === 0 ? undefined : page;
    },
    recomputeCurrentPage: recompute,
    scrollPageIntoView: (page) => {
      const element = findPageElement(page);
      if (element) {
        scrollPageIntoView(element);
      }
    },
    goToPreviousPage: () => {
      const page = Math.max((currentPage() ?? 0) - 1, 1);
      const element = findPageElement(page);
      if (element) {
        scrollPageIntoView(element);
      }
    },
    goToNextPage: () => {
      const { pageCount } = options;
      const current = currentPage() ?? 0;
      const page = pageCount === undefined ? current + 1 : Math.min(current + 1, pageCount());
      const element = findPageElement(page);
      if (element) {
        scrollPageIntoView(element);
      }
    },
  };
}
