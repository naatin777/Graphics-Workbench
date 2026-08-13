import { expect, test } from '@playwright/test';

import { expectPdfCanvasesReadable, renderAllPdfPreviewPages, webviewUrl } from './helpers/browser';

test('600px幅でCropの設定ペインとプレビューが両方表示され操作できる', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'crop-pdf' }));

  const preview = page.getByRole('region', { name: 'Preview' });
  const settings = page.getByRole('region', { name: 'Crop settings' });

  await expect(preview).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();

  const canvases = page.locator('canvas[data-pdf-page]');
  await expect(canvases).toHaveCount(1);
  await renderAllPdfPreviewPages(page);
  await expectPdfCanvasesReadable(canvases);

  const left = settings.getByRole('spinbutton', { name: 'Left', exact: true });
  await expect(left).toBeEnabled();
  await left.fill('50');
  await expect(left).toHaveValue('50');
});

test('600px幅でSplitが縦積みになりgroup編集できる', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'split-pdf' }));

  await expect
    .poll(async () => {
      const style = await page
        .locator('.split-pane')
        .evaluate((element) => element.ownerDocument.defaultView?.getComputedStyle(element));
      return style?.flexDirection === 'column';
    })
    .toBe(true);
  await expect(page.locator('.split-pane__divider')).toBeHidden();

  const pages = page.getByRole('textbox', { name: 'Pages 1', exact: true });
  const groups = page.getByRole('region', { name: 'Groups' });
  await expect(groups).toBeVisible();
  await pages.fill('1');
  await expect(page.locator('canvas[data-pdf-page="1"]')).toBeVisible();
});
