import { expect, test } from '@playwright/test';

import {
  expectPdfCanvasesReadable,
  expectPreviewScrollable,
  renderAllPdfPreviewPages,
  webviewUrl,
} from './helpers/browser';

test('Crop PDF Configureを開きPDFを表示できる', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'crop-pdf' }));

  await expect(page.getByRole('heading', { name: 'Custom Crop', exact: true })).toBeVisible();
  await expect(page.locator('p.sr-only').first()).toContainText('sample.pdf · 3 Pages');

  const preview = page.getByRole('region', { name: 'Preview' });
  const settings = page.getByRole('region', { name: 'Crop settings' });
  const canvases = page.locator('canvas[data-pdf-page]');

  await expect(preview).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(canvases).toHaveCount(1);
  await renderAllPdfPreviewPages(page);
  await expectPdfCanvasesReadable(canvases);
  await expect(page.getByText(/PDFを表示できませんでした:/u)).toHaveCount(0);
});

test('scenario=largeはmulti-page-table.pdfを描画する', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'crop-pdf', scenario: 'large' }));

  const canvases = page.locator('canvas[data-pdf-page]');
  await expect(canvases).toHaveCount(2);
  await renderAllPdfPreviewPages(page);
  await expectPdfCanvasesReadable(canvases);
});

test('PDFプレビューのズーム操作が表示倍率とスクロールを維持する', async ({ page }) => {
  const projectViewport = page.viewportSize();
  if (!projectViewport) {
    throw new Error('Playwright viewport was not configured.');
  }
  await page.setViewportSize({ width: projectViewport.width, height: 380 });
  await page.goto(webviewUrl({ page: 'crop-pdf' }));

  const previewPages = page.locator('.pdf-preview__pages');
  const settings = page.getByRole('region', { name: 'Crop settings' });
  const canvases = page.locator('canvas[data-pdf-page]');
  await expect(canvases).toHaveCount(1);
  await expectPreviewScrollable(previewPages);

  const cropInputs = settings.locator('input[type="number"]');
  const readCropValues = async (): Promise<string[]> =>
    Promise.all(Array.from({ length: await cropInputs.count() }, (_, index) => cropInputs.nth(index).inputValue()));
  const initialCropValues = await readCropValues();
  const initialCanvasWidth = await canvases.first().evaluate((canvas) => canvas.getBoundingClientRect().width);

  await previewPages.evaluate((element) => {
    element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, 180);
  });
  await expect.poll(() => previewPages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.zoom__value')).toHaveText('125%');
  await expect
    .poll(() => canvases.first().evaluate((canvas) => canvas.getBoundingClientRect().width))
    .toBeGreaterThan(initialCanvasWidth);
  await expect.poll(() => previewPages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(readCropValues).toEqual(initialCropValues);

  const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.locator('.pdf-preview').hover();
  await page.keyboard.down(modifierKey);
  try {
    await page.mouse.wheel(0, -100);
  } finally {
    await page.keyboard.up(modifierKey);
  }
  await expect(page.locator('.zoom__value')).toHaveText('135%');

  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(page.locator('.zoom__value')).toHaveText('110%');
});

test('不正なCrop boxはエラーになり、正しい値のApply中はProcessing状態になる', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'crop-pdf' }));

  const settings = page.getByRole('region', { name: 'Crop settings' });
  const canvases = page.locator('canvas[data-pdf-page]');
  await renderAllPdfPreviewPages(page);
  await expectPdfCanvasesReadable(canvases);

  const left = settings.getByRole('spinbutton', { name: 'Left', exact: true });
  const bottom = settings.getByRole('spinbutton', { name: 'Bottom', exact: true });
  const right = settings.getByRole('spinbutton', { name: 'Right', exact: true });
  const top = settings.getByRole('spinbutton', { name: 'Top', exact: true });

  await left.fill('500');
  await bottom.fill('0');
  await right.fill('100');
  await top.fill('200');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Crop box must have positive width and height.');

  await left.fill('20');
  await bottom.fill('30');
  await right.fill('200');
  await top.fill('280');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();

  const processing = settings.getByRole('button', { name: 'Processing…', exact: true });
  await expect(processing).toBeVisible();
  await expect(processing).toBeDisabled();
  await expect(settings).toHaveAttribute('aria-busy', 'true');
  await expect(left).toBeDisabled();
  await expect(right).toBeDisabled();
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(resolve);
      }),
  );
  await expect(processing).toBeDisabled();
});
