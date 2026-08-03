import { calculatePageWindow } from '../../../shared/pdf/page_window';

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
});
