import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  expectPdfCanvasesReadable,
  expectWebviewBodyTheme,
  renderAllPdfPreviewPages,
  webviewUrl,
  type readWebviewBodyColors,
  type ThemeQuery,
} from './helpers/browser';

async function openCropPdf(page: Page, query: ThemeQuery): Promise<{ body: Locator; canvases: Locator }> {
  await page.goto(webviewUrl({ page: 'crop-pdf', theme: query }));
  await renderAllPdfPreviewPages(page);
  return { body: page.locator('body'), canvases: page.locator('canvas[data-pdf-page]') };
}

test('dark/light themeへ追従しcanvasが読める', async ({ page }) => {
  const darkState = await (async (): Promise<ReturnType<typeof readWebviewBodyColors>> => {
    const { body, canvases } = await openCropPdf(page, 'dark');
    const state = await expectWebviewBodyTheme(body, 'vscode-dark');
    await expectPdfCanvasesReadable(canvases);
    return state;
  })();

  const { body, canvases } = await openCropPdf(page, undefined);
  const lightState = await expectWebviewBodyTheme(body, 'vscode-light');
  expect(lightState.bodyBackground).not.toBe(darkState.bodyBackground);
  expect(lightState.bodyForeground).not.toBe(darkState.bodyForeground);
  await expectPdfCanvasesReadable(canvases);
});

test('high contrastテーマでもcanvasが読める', async ({ page }) => {
  const { body, canvases } = await openCropPdf(page, 'high-contrast');
  await expectWebviewBodyTheme(body, 'vscode-high-contrast');
  await expectPdfCanvasesReadable(canvases);
});

test('split PDFとmerge PDFもテーマに追従する', async ({ page }) => {
  await page.goto(webviewUrl({ page: 'split-pdf', theme: 'dark' }));
  const splitBody = page.locator('body');
  const splitDark = await expectWebviewBodyTheme(splitBody, 'vscode-dark');
  await page.getByRole('textbox', { name: 'Pages 1', exact: true }).fill('1');
  await expectPdfCanvasesReadable(page.locator('canvas[data-pdf-page="1"]'));

  await page.goto(webviewUrl({ page: 'merge-pdf', theme: undefined }));
  const mergeBody = page.locator('body');
  const mergeLight = await expectWebviewBodyTheme(mergeBody, 'vscode-light');
  await expect(page.locator('.source-card')).toHaveCount(2);
  await expectPdfCanvasesReadable(page.locator('.thumbnail__canvas'));

  expect(mergeLight.bodyBackground).not.toBe(splitDark.bodyBackground);
  expect(mergeLight.bodyForeground).not.toBe(splitDark.bodyForeground);
});
