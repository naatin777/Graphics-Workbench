import { expect, test } from '@playwright/test';

import { webviewUrl } from './helpers/browser';

test('公開UIでMerge順を変更できCancelボタンがある', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'merge-pdf' }));

  const sourceNames = page.locator('.source-card h3');
  await expect(sourceNames).toHaveText(['sample.pdf', 'second.pdf']);

  await page.getByRole('button', { name: 'Move down', exact: true }).first().click();
  await expect(sourceNames).toHaveText(['second.pdf', 'sample.pdf']);

  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Merge PDF', exact: true })).toBeVisible();
  await expect(sourceNames).toHaveText(['second.pdf', 'sample.pdf']);
});

test('2つのsourceでApplyできるが1つになると無効になる', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'merge-pdf' }));

  const apply = page.getByRole('button', { name: 'Apply', exact: true });
  await expect(page.locator('.source-card')).toHaveCount(2);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(apply).toBeEnabled();

  await page
    .getByRole('button', { name: /^Remove:/ })
    .first()
    .click();
  await expect(page.locator('.source-card')).toHaveCount(1);
  await expect(apply).toBeDisabled();
});
