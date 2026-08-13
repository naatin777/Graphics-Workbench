import { expect, test, type Page } from '@playwright/test';

import { expectPreviewScrollable, renderAllPdfPreviewPages, webviewUrl } from './helpers/browser';

async function selectFirstSplitPage(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Pages 1', exact: true }).fill('1');
  await page.getByRole('button', { name: 'All pages', exact: true }).click();
  await renderAllPdfPreviewPages(page);
}

test('分割ペインが幅に応じて配置され長幅でドラッグ調整できる', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(viewport === null || viewport.width <= 900, 'divider drag requires a wide viewport');
  await page.goto(webviewUrl({ page: 'split-pdf' }));

  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview).toBeVisible();

  const divider = page.locator('.split-pane__divider');
  await expect(divider).toBeVisible();

  const dividerBox = await divider.boundingBox();
  if (!dividerBox) {
    throw new Error('Split divider has no visible bounds.');
  }

  const beforeWidth = await preview.evaluate((element) => element.getBoundingClientRect().width);
  const dividerCenterX = dividerBox.x + dividerBox.width / 2;
  const dividerCenterY = dividerBox.y + dividerBox.height / 2;

  await page.mouse.move(dividerCenterX, dividerCenterY);
  await page.mouse.down();
  await page.mouse.move(dividerCenterX - 120, dividerCenterY, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => (await preview.evaluate((element) => element.getBoundingClientRect().width)) < beforeWidth)
    .toBe(true);

  const afterWidth = await preview.evaluate((element) => element.getBoundingClientRect().width);
  expect(afterWidth).toBeLessThan(beforeWidth);
});

test('グループ入力中にフォーカスを維持する', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'split-pdf' }));

  const pages = page.getByRole('textbox', { name: 'Pages 1', exact: true });
  const outputName = page.getByRole('textbox', { name: 'Output name 1', exact: true });

  await pages.fill('1-2');
  await expect.poll(() => pages.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true);
  await expect(outputName).toHaveValue('1-2');
});

test('グループを追加して並べ替えられる', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'split-pdf' }));

  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await expect(page.locator('.group-row')).toHaveCount(2);

  const firstPages = page.getByRole('textbox', { name: 'Pages 1', exact: true });
  const secondPages = page.getByRole('textbox', { name: 'Pages 2', exact: true });
  await firstPages.fill('1');
  await secondPages.fill('2');

  await page.getByRole('button', { name: 'Move down 1', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Pages 1', exact: true })).toHaveValue('2');
  await expect(page.getByRole('textbox', { name: 'Pages 2', exact: true })).toHaveValue('1');
});

test('PDFプレビューのズーム入力とCtrlまたはCommandホイールが動作する', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'split-pdf', scenario: 'large' }));

  const previewPages = page.locator('.pdf-preview__pages');
  const canvases = page.locator('canvas[data-pdf-page]');
  await selectFirstSplitPage(page);
  await expect(canvases).toHaveCount(2);

  const numericZoom = page.locator('input[type="number"][aria-label="Zoom"]');
  const rangeZoom = page.locator('input[type="range"][aria-label="Zoom"]');
  const initialCanvasWidth = await canvases.first().evaluate((canvas) => canvas.getBoundingClientRect().width);

  await numericZoom.fill('200');
  await expect(numericZoom).toHaveValue('200');
  await expect(rangeZoom).toHaveValue('200');
  await expect
    .poll(() => canvases.first().evaluate((canvas) => canvas.getBoundingClientRect().width))
    .toBeGreaterThan(initialCanvasWidth);
  await expectPreviewScrollable(previewPages);

  await previewPages.evaluate((element) => {
    element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, 180);
  });
  await expect.poll(() => previewPages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.locator('.pdf-preview').hover();
  await page.keyboard.down(modifierKey);
  try {
    await page.mouse.wheel(0, -100);
  } finally {
    await page.keyboard.up(modifierKey);
  }
  await expect.poll(() => previewPages.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(numericZoom).toHaveValue('205');
  await expect(rangeZoom).toHaveValue('205');
});

test('入力したグループ設定でApplyでき、不正なページはApplyを無効にする', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'split-pdf' }));

  const pages = page.getByRole('textbox', { name: 'Pages 1', exact: true });
  const apply = page.getByRole('button', { name: 'Apply', exact: true });

  await expect(apply).toBeDisabled();

  await pages.fill('99');
  await expect(apply).toBeDisabled();

  await pages.fill('1-2');
  await expect(page.locator('canvas[data-pdf-page="1"]')).toBeVisible();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(apply).toBeEnabled();
});
