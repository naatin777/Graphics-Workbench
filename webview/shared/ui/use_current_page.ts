import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

/**
 * Tracks which page in a preview scroll container is the "current" page.
 *
 * Priority:
 * 1. the page with the largest viewport intersection area,
 * 2. on a tie, the page whose center is closest to the viewport center,
 * 3. otherwise the previous current page is kept.
 *
 * Pages are re-evaluated on scroll, on zoom / container size changes and on
 * PDF re-render (callers invoke `recompute` after such changes).
 */
export function useCurrentPage(options: {
  scrollContainer: () => HTMLElement | undefined;
  getPageElements: () => HTMLElement[];
  resetKey?: Accessor<unknown>;
}): { currentPage: Accessor<number>; recompute: () => void } {
  const [currentPage, setCurrentPage] = createSignal(0);
  let observer: IntersectionObserver | undefined;
  let lastScheduled: number | undefined;

  const compute = (): void => {
    const container = options.scrollContainer();
    const pages = options.getPageElements();
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

  onMount(() => {
    const container = options.scrollContainer();
    if (!container) {
      return;
    }

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        () => {
          scheduleCompute();
        },
        { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] },
      );
      for (const page of options.getPageElements()) {
        observer.observe(page);
      }
    }

    compute();
    container.addEventListener('scroll', scheduleCompute, { passive: true });
    window.addEventListener('resize', scheduleCompute);

    onCleanup(() => {
      observer?.disconnect();
      observer = undefined;
      container.removeEventListener('scroll', scheduleCompute);
      window.removeEventListener('resize', scheduleCompute);
      if (lastScheduled !== undefined) {
        cancelAnimationFrame(lastScheduled);
        lastScheduled = undefined;
      }
    });
  });

  return {
    currentPage,
    recompute: compute,
  };
}
