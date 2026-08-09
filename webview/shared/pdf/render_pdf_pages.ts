// PDF.js reads this Map method while its module is evaluated, so the polyfill must run first.
import './install_map_get_or_insert_computed';

import * as pdfjsModule from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import {
  calculatePageWindow,
  insertPageFrameInOrder,
  MAX_RENDERED_PAGES,
  shouldUseWindowedRendering,
} from './page_window';
import { calculatePdfCanvasDimensions } from './canvas_limits';

type PdfJs = typeof pdfjsModule;

const sharedPdfJsAssetsPath = '../pdfjs';
const PAGE_GAP_PX = 12;

export interface PdfRenderController {
  firstPageReady: Promise<void>;
  dispose: () => Promise<void>;
}

export async function renderFirstPdfPage(
  pdfSrc: string,
  canvas: HTMLCanvasElement,
  options: PdfRenderOptions = {},
): Promise<void> {
  throwIfAborted(options.signal);
  const pdfjs = await loadPdfJs(options.resources?.workerSrc);

  const loadingTask = pdfjs.getDocument(createDocumentOptions(pdfSrc, options));
  let renderTask: ReturnType<PDFPageProxy['render']> | undefined;
  const abort = (): void => {
    renderTask?.cancel();
    void loadingTask.destroy();
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const document = await loadingTask.promise;
    try {
      throwIfAborted(options.signal);
      const page = await document.getPage(1);
      try {
        throwIfAborted(options.signal);
        renderTask = renderPageToCanvasWithTask(page, canvas, options);
        await renderTask.promise;
      } finally {
        renderTask = undefined;
        page.cleanup();
      }
    } finally {
      await document.cleanup();
    }
  } catch (error: unknown) {
    if (options.signal?.aborted === true) {
      throw createAbortError();
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await loadingTask.destroy();
  }
}

export async function renderPdfPages(
  pdfSrc: string,
  container: HTMLElement,
  options: PdfRenderOptions = {},
): Promise<PdfRenderController> {
  throwIfAborted(options.signal);
  const pdfjs = await loadPdfJs(options.resources?.workerSrc);

  const loadingTask = pdfjs.getDocument(createDocumentOptions(pdfSrc, options));
  const abortLoading = (): void => {
    void loadingTask.destroy();
  };
  options.signal?.addEventListener('abort', abortLoading, { once: true });

  let document: PDFDocumentProxy;
  try {
    document = await loadingTask.promise;
    throwIfAborted(options.signal);
  } catch (error: unknown) {
    options.signal?.removeEventListener('abort', abortLoading);
    if (options.signal?.aborted === true) {
      throw createAbortError();
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
  options.signal?.removeEventListener('abort', abortLoading);

  if (shouldUseWindowedRendering(document.numPages, options.virtualize)) {
    return attachRenderSignal(createWindowedRenderController(), options.signal);
  }

  const renderPromises = new Map<number, Promise<void>>();
  const pages = new Map<number, PDFPageProxy>();
  const renderTasks = new Set<ReturnType<PDFPageProxy['render']>>();
  const renderState = { disposed: false };

  container.replaceChildren();
  container.style.removeProperty('display');
  const pageFrames: HTMLElement[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const pageFrame = createPdfPageFrame(container, pageNumber, options);
    container.append(pageFrame);
    pageFrames.push(pageFrame);
  }

  const renderPage = async (pageNumber: number): Promise<void> => {
    const existing = renderPromises.get(pageNumber);

    if (existing) {
      return existing;
    }

    const pageFrame = pageFrames[pageNumber - 1];
    const canvas = pageFrame?.querySelector<HTMLCanvasElement>('canvas[data-pdf-page]');

    if (!canvas) {
      throw new Error(`Could not create PDF page ${pageNumber}.`);
    }

    const renderPromise = (async (): Promise<void> => {
      try {
        if (renderState.disposed) {
          return;
        }

        const page = await document.getPage(pageNumber);
        pages.set(pageNumber, page);

        // The returned controller can dispose this state while getPage is pending.
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- preserve async disposal cleanup
        if (renderState.disposed) {
          page.cleanup();
          return;
        }

        const renderTask = renderPageToCanvasWithTask(page, canvas, options);
        renderTasks.add(renderTask);

        try {
          await renderTask.promise;
        } finally {
          renderTasks.delete(renderTask);
          page.cleanup();
        }
      } catch (error: unknown) {
        if (options.signal?.aborted !== true) {
          options.onRenderError?.(error);
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
    })();

    renderPromises.set(pageNumber, renderPromise);
    return renderPromise;
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

              const pageNumber = Number(entry.target instanceof HTMLElement ? entry.target.dataset.pdfPage : undefined);
              void (async (): Promise<void> => {
                try {
                  await renderPage(pageNumber);
                } catch {
                  // The render error was already reported through onRenderError.
                }
              })();
            }
          },
          {
            root: options.root ?? null,
            rootMargin: '0px',
          },
        );

  for (const pageFrame of pageFrames) {
    observer?.observe(pageFrame);
  }

  const firstPageReady = renderPage(1);

  return attachRenderSignal(
    {
      firstPageReady,
      async dispose(): Promise<void> {
        if (renderState.disposed) {
          return;
        }

        renderState.disposed = true;
        observer?.disconnect();
        for (const renderTask of renderTasks) {
          renderTask.cancel();
        }
        await Promise.allSettled(renderPromises.values());

        for (const page of pages.values()) {
          page.cleanup();
        }

        await document.cleanup();
        await loadingTask.destroy();
      },
    },
    options.signal,
  );

  function createWindowedRenderController(): PdfRenderController {
    const windowRenderPromises = new Map<number, Promise<void>>();
    const windowRenderingPages = new Set<number>();
    const windowPages = new Map<number, PDFPageProxy>();
    const windowRenderTasks = new Set<ReturnType<PDFPageProxy['render']>>();
    const windowPageFrames = new Map<number, HTMLElement>();
    const windowRenderState = { disposed: false };
    const pageWindow = container.ownerDocument.createElement('div');
    const topSpacer = container.ownerDocument.createElement('div');
    const bottomSpacer = container.ownerDocument.createElement('div');
    let estimatedPageHeight = 400;
    let windowStart = 1;
    let windowEnd = Math.min(document.numPages, MAX_RENDERED_PAGES);

    pageWindow.className = 'pdf-page-window';
    topSpacer.setAttribute('aria-hidden', 'true');
    bottomSpacer.setAttribute('aria-hidden', 'true');
    container.replaceChildren(topSpacer, pageWindow, bottomSpacer);
    container.style.display = 'block';
    pageWindow.style.display = 'grid';
    pageWindow.style.gap = `${PAGE_GAP_PX}px`;
    pageWindow.style.justifyItems = 'center';

    const updateSpacers = (): void => {
      const stride = estimatedPageHeight + PAGE_GAP_PX;
      topSpacer.style.height = `${Math.max(0, windowStart - 1) * stride}px`;
      bottomSpacer.style.height = `${Math.max(0, document.numPages - windowEnd) * stride}px`;
    };

    const createPageFrame = (pageNumber: number): HTMLElement => createPdfPageFrame(container, pageNumber, options);

    const renderWindowPage = async (pageNumber: number): Promise<void> => {
      const existing = windowRenderPromises.get(pageNumber);
      if (existing) {
        return existing;
      }

      const renderPromise = (async (): Promise<void> => {
        try {
          if (windowRenderState.disposed) {
            return;
          }

          const page = await document.getPage(pageNumber);
          windowPages.set(pageNumber, page);
          const pageFrame = windowPageFrames.get(pageNumber);
          // The scroll handler can evict a page while getPage is pending.
          // oxlint-disable-next-line typescript/no-unnecessary-condition
          if (windowRenderState.disposed || pageFrame === undefined) {
            page.cleanup();
            windowPages.delete(pageNumber);
            return;
          }
          const canvas = pageFrame.querySelector<HTMLCanvasElement>('canvas[data-pdf-page]');
          if (canvas === null) {
            page.cleanup();
            windowPages.delete(pageNumber);
            return;
          }

          const renderTask = renderPageToCanvasWithTask(page, canvas, options);
          windowRenderTasks.add(renderTask);
          windowRenderingPages.add(pageNumber);
          try {
            await renderTask.promise;
          } finally {
            windowRenderingPages.delete(pageNumber);
            windowRenderTasks.delete(renderTask);
            if (!windowPageFrames.has(pageNumber)) {
              page.cleanup();
              windowPages.delete(pageNumber);
              windowRenderPromises.delete(pageNumber);
            }
          }

          if (pageNumber === 1) {
            const pageHeight = Number(canvas.dataset.pdfHeight);
            if (Number.isFinite(pageHeight) && pageHeight > 0) {
              estimatedPageHeight = pageHeight;
              updateSpacers();
            }
          }
        } catch (error: unknown) {
          if (!windowRenderState.disposed && windowPageFrames.has(pageNumber)) {
            if (options.signal?.aborted !== true) {
              options.onRenderError?.(error);
            }
          }
          throw error instanceof Error ? error : new Error(String(error));
        }
      })();

      windowRenderPromises.set(pageNumber, renderPromise);
      return renderPromise;
    };

    const updateWindow = (): void => {
      if (windowRenderState.disposed) {
        return;
      }

      const { root } = options;
      const scrollTop = root?.scrollTop ?? 0;
      const viewportHeight = root?.clientHeight ?? estimatedPageHeight * MAX_RENDERED_PAGES;
      const pageWindowRange = calculatePageWindow(document.numPages, scrollTop, viewportHeight, estimatedPageHeight);
      windowStart = pageWindowRange.start;
      windowEnd = pageWindowRange.end;

      for (const [pageNumber, pageFrame] of windowPageFrames) {
        if (pageNumber < windowStart || pageNumber > windowEnd) {
          pageFrame.remove();
          windowPageFrames.delete(pageNumber);
          windowPages.get(pageNumber)?.cleanup();
          windowPages.delete(pageNumber);
          if (!windowRenderingPages.has(pageNumber)) {
            windowRenderPromises.delete(pageNumber);
          }
        }
      }

      for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) {
        if (!windowPageFrames.has(pageNumber)) {
          const pageFrame = createPageFrame(pageNumber);
          windowPageFrames.set(pageNumber, pageFrame);
          insertPageFrameInOrder(pageWindow, pageFrame);
        }
      }

      updateSpacers();
      for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) {
        void (async (): Promise<void> => {
          try {
            await renderWindowPage(pageNumber);
          } catch {
            // The render error was already reported through onRenderError.
          }
        })();
      }
    };

    const scrollRoot = options.root;
    scrollRoot?.addEventListener('scroll', updateWindow, { passive: true });
    updateWindow();
    const windowFirstPageReady = renderWindowPage(1);

    return {
      firstPageReady: windowFirstPageReady,
      async dispose(): Promise<void> {
        if (windowRenderState.disposed) {
          return;
        }

        windowRenderState.disposed = true;
        scrollRoot?.removeEventListener('scroll', updateWindow);
        for (const renderTask of windowRenderTasks) {
          renderTask.cancel();
        }
        await Promise.allSettled(windowRenderPromises.values());

        for (const page of windowPages.values()) {
          page.cleanup();
        }

        container.replaceChildren();
        container.style.removeProperty('display');
        await document.cleanup();
        await loadingTask.destroy();
      },
    };
  }
}

function createPdfPageFrame(container: HTMLElement, pageNumber: number, options: PdfRenderOptions): HTMLElement {
  const pageFrame = container.ownerDocument.createElement('figure');
  pageFrame.className = 'pdf-page';
  pageFrame.dataset.pdfPage = pageNumber.toString();

  const canvas = container.ownerDocument.createElement('canvas');
  canvas.dataset.pdfPage = pageNumber.toString();
  canvas.className = 'pdf-page__canvas';
  canvas.setAttribute('aria-label', `${options.page?.label ?? 'Page'} ${pageNumber}`);
  pageFrame.append(canvas);
  options.page?.onCreated?.(pageFrame, pageNumber);
  return pageFrame;
}

function attachRenderSignal(controller: PdfRenderController, signal: AbortSignal | undefined): PdfRenderController {
  if (signal === undefined) {
    return controller;
  }

  let disposed = false;
  const { dispose } = controller;
  const abort = (): void => {
    void dispose();
  };
  signal.addEventListener('abort', abort, { once: true });

  return {
    firstPageReady: controller.firstPageReady,
    async dispose(): Promise<void> {
      if (disposed) {
        return;
      }

      disposed = true;
      signal.removeEventListener('abort', abort);
      await dispose();
    },
  };
}

async function loadPdfJs(workerSrc?: string): Promise<PdfJs> {
  pdfjsModule.GlobalWorkerOptions.workerSrc = nonEmptyOrDefault(workerSrc, `${sharedPdfJsAssetsPath}/pdf.worker.mjs`);
  return pdfjsModule;
}

export interface PdfRenderOptions {
  resources?: {
    workerSrc?: string;
    cMapUrl?: string;
    standardFontDataUrl?: string;
    wasmUrl?: string;
  };
  data?: Uint8Array | string;
  root?: Element;
  page?: {
    label?: string;
    onCreated?: (pageFrame: HTMLElement, pageNumber: number) => void;
  };
  onRenderError?: (error: unknown) => void;
  signal?: AbortSignal;
  preview?: {
    maxCanvasPixels: number;
    maxDevicePixelRatio: number;
  };
  virtualize?: boolean;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error('PDF preview rendering was cancelled.');
  error.name = 'AbortError';
  return error;
}

function createDocumentOptions(pdfSrc: string, options: PdfRenderOptions): Parameters<PdfJs['getDocument']>[0] {
  const { resources, data } = options;
  return {
    ...(data === undefined ? { url: pdfSrc } : { data }),
    cMapPacked: true,
    useWorkerFetch: false,
    cMapUrl: nonEmptyOrDefault(resources?.cMapUrl, `${sharedPdfJsAssetsPath}/cmaps/`),
    standardFontDataUrl: nonEmptyOrDefault(resources?.standardFontDataUrl, `${sharedPdfJsAssetsPath}/standard_fonts/`),
    wasmUrl: nonEmptyOrDefault(resources?.wasmUrl, `${sharedPdfJsAssetsPath}/wasm/`),
  };
}

function nonEmptyOrDefault(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value;
}

function renderPageToCanvasWithTask(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  options: PdfRenderOptions = {},
): ReturnType<PDFPageProxy['render']> {
  const viewport = page.getViewport({ scale: 1 });
  const dimensions = calculatePdfCanvasDimensions(
    viewport.width,
    viewport.height,
    globalThis.devicePixelRatio,
    options.preview,
  );
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Could not create a 2D context for the PDF canvas.');
  }

  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  canvas.dataset.pdfWidth = viewport.width.toString();
  canvas.dataset.pdfHeight = viewport.height.toString();
  canvas.style.width = `${dimensions.cssWidth}px`;
  canvas.style.height = `${dimensions.cssHeight}px`;

  return page.render({
    canvas,
    canvasContext: context,
    ...(dimensions.outputScale === 1
      ? {}
      : { transform: [dimensions.outputScale, 0, 0, dimensions.outputScale, 0, 0] }),
    viewport,
  });
}
