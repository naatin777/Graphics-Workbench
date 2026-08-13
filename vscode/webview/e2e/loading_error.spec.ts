import { expect, test } from '@playwright/test';

import { expectPdfCanvasesReadable, renderAllPdfPreviewPages, webviewUrl } from './helpers/browser';

test('pageパラメータなしのルートはunknown page errorになる', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/');

  await expect.poll(() => pageErrors.some((message) => message.includes('Unknown webview page id'))).toBe(true);
  await expect(page.locator('#root .app')).toHaveCount(0);
});

test('previewページはpdfDataからエラーなく描画できる', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(webviewUrl({ page: 'preview' }));

  await expect(page.locator('p.sr-only').first()).toContainText('sample.pdf · 3 pages');
  const canvases = page.locator('canvas[data-pdf-page]');
  await expect(canvases).toHaveCount(1);
  await renderAllPdfPreviewPages(page, '.preview__pages');
  await expectPdfCanvasesReadable(canvases);
  await expect(page.locator('.preview__error')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('scenario=largeのpreviewはmulti-page-table.pdfを描画できる', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'preview', scenario: 'large' }));

  const canvases = page.locator('canvas[data-pdf-page]');
  await expect(canvases).toHaveCount(2);
  await renderAllPdfPreviewPages(page, '.preview__pages');
  await expectPdfCanvasesReadable(canvases);
  await expect(page.locator('.preview__error')).toHaveCount(0);
});
