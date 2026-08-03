const WINDOW_SIZE = 24;
const WINDOW_BUFFER = 4;
const PAGE_GAP_PX = 12;

export function calculatePageWindow(
  pageCount: number,
  scrollTop: number,
  viewportHeight: number,
  estimatedPageHeight: number,
): { start: number; end: number } {
  const stride = estimatedPageHeight + PAGE_GAP_PX;
  const visibleStart = Math.max(1, Math.floor(scrollTop / stride) + 1);
  const visibleEnd = Math.min(pageCount, Math.ceil((scrollTop + viewportHeight) / stride) + 1);
  const nextStart = Math.max(1, visibleStart - WINDOW_BUFFER);
  const nextEnd = Math.min(pageCount, Math.max(visibleEnd + WINDOW_BUFFER, nextStart + WINDOW_SIZE - 1));

  return {
    start: Math.max(1, nextEnd - WINDOW_SIZE + 1),
    end: Math.min(pageCount, nextEnd),
  };
}

export const MAX_RENDERED_PAGES = WINDOW_SIZE;
