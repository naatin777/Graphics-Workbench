import {
  calculatePageWindow,
  insertPageFrameInOrder,
  shouldUseWindowedRendering,
} from '../../../shared/pdf/page_window';

describe('PDF preview page window', () => {
  test('keeps the rendered page count bounded for a large document', () => {
    const pageWindow = calculatePageWindow(10_000, 500_000, 900, 800);

    expect(pageWindow.end - pageWindow.start + 1).toBeLessThanOrEqual(24);
    expect(pageWindow.start).toBeGreaterThan(1);
    expect(pageWindow.end).toBeLessThanOrEqual(10_000);
  });

  test('keeps the first page in the initial window', () => {
    expect(calculatePageWindow(10_000, 0, 900, 800)).toEqual({ start: 1, end: 24 });
  });

  test('keeps DOM order by page number after scrolling back to earlier pages', () => {
    const container = document.createElement('div');
    const createFrame = (pageNumber: number): HTMLElement => {
      const frame = document.createElement('figure');
      frame.dataset.pdfPage = pageNumber.toString();
      return frame;
    };

    for (let pageNumber = 10; pageNumber <= 24; pageNumber += 1) {
      insertPageFrameInOrder(container, createFrame(pageNumber));
    }
    for (let pageNumber = 1; pageNumber <= 9; pageNumber += 1) {
      insertPageFrameInOrder(container, createFrame(pageNumber));
    }

    const order = [...container.children]
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .map((child) => Number(child.dataset.pdfPage));
    expect(order).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
  });

  test('virtualize未指定では32ページ超過でwindowed renderingを維持する', () => {
    expect(shouldUseWindowedRendering(1, undefined)).toBe(false);
    expect(shouldUseWindowedRendering(32, undefined)).toBe(false);
    expect(shouldUseWindowedRendering(33, undefined)).toBe(true);
  });

  test('virtualize: falseでは全ページフレームを作るためwindowed renderingを使わない', () => {
    expect(shouldUseWindowedRendering(33, false)).toBe(false);
    expect(shouldUseWindowedRendering(1000, false)).toBe(false);
  });
});
