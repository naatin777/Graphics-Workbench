import { expect, test } from '@playwright/test';

import { renderAllPdfPreviewPages, webviewUrl } from './helpers/browser';

test('Rotate Configureで選択pageにborder/outlineが表示される', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'rotate-pdf', scenario: 'large' }));
  await renderAllPdfPreviewPages(page, '.rotate__pages');

  const pages = page.locator('.pdf-page');
  await expect(pages).not.toHaveCount(0);
  const firstPage = pages.first();

  await expect
    .poll(() => firstPage.evaluate((element) => element.classList.contains('pdf-page--selected')))
    .toBe(false);

  await firstPage.click();
  await expect.poll(() => firstPage.evaluate((element) => element.classList.contains('pdf-page--selected'))).toBe(true);

  const selectedStyle = await firstPage.evaluate((element) => {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (!style) {
      return { borderColor: '', outline: '' };
    }
    return { borderColor: style.borderColor, outline: style.outline };
  });
  expect(selectedStyle.borderColor).not.toBe('transparent');
  expect(selectedStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(selectedStyle.outline).not.toBe('none');

  await expect(page.locator('.rotate__selection')).toHaveText(/\d+\/\d+/u);
});

test('Reorder Configureのcontrolが対応page内に配置され、複数pageで重ならない', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'reorder-pdf', scenario: 'large' }));
  await renderAllPdfPreviewPages(page, '.reorder__pages');

  const pages = page.locator('.pdf-page');
  const pageCount = await pages.count();
  expect(pageCount).toBeGreaterThan(1);

  for (const pageElement of await pages.all()) {
    const controls = pageElement.locator('.reorder-page__controls');
    await expect(controls).toHaveCount(1);
  }

  await expect
    .poll(async () => {
      const layouts = await pages.evaluateAll((elements) =>
        elements.map((element) => {
          const pageRect = element.getBoundingClientRect();
          const controlRect = element.querySelector('.reorder-page__controls')?.getBoundingClientRect();
          if (!controlRect) {
            return { contained: false };
          }
          return {
            contained:
              controlRect.top >= pageRect.top &&
              controlRect.bottom <= pageRect.bottom &&
              controlRect.left >= pageRect.left &&
              controlRect.right <= pageRect.right,
            left: controlRect.left,
            right: controlRect.right,
            top: controlRect.top,
            bottom: controlRect.bottom,
          };
        }),
      );

      const contained = layouts.every((layout) => layout.contained);
      const overlaps = layouts.some((current, index) =>
        layouts.slice(index + 1).some((other) => {
          if (
            current.left === undefined ||
            current.right === undefined ||
            current.top === undefined ||
            current.bottom === undefined ||
            other.left === undefined ||
            other.right === undefined ||
            other.top === undefined ||
            other.bottom === undefined
          ) {
            return false;
          }
          const horizontalOverlap = current.left < other.right - 1 && current.right > other.left + 1;
          const verticalOverlap = current.top < other.bottom - 1 && current.bottom > other.top + 1;
          return horizontalOverlap && verticalOverlap;
        }),
      );

      return contained && !overlaps;
    })
    .toBe(true);

  await page.locator('.reorder-page__move-down').first().click();
  await expect
    .poll(async () => {
      const order = await pages.evaluateAll((elements) => elements.map((element) => element.dataset.pdfPage));
      return order.length >= 2 && order[0] === '2' && order[1] === '1';
    })
    .toBe(true);
});
