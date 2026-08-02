import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { selectExplorerEntry } from './crop_pdf_webview.js';
import { settleWebviewPaint, waitForWebviewFontsReady } from './crop_pdf_screenshot.js';

export interface SplitPdfWebview {
  body: Locator;
  canvases: Locator;
  frame: Frame;
  preview: Locator;
  groups: Locator;
}

export async function openSplitPdfConfigure(vscodeWindow: Page, fileName: string): Promise<SplitPdfWebview> {
  await expect(vscodeWindow.getByText('Safe Mode: ON', { exact: true })).toBeVisible();

  const explorer = vscodeWindow.getByRole('tree', { name: 'Files Explorer' });
  await expect(explorer).toBeVisible();

  const pdfEntry = explorer.getByRole('treeitem', { name: fileName });
  await expect(pdfEntry).toBeVisible();
  await selectExplorerEntry(pdfEntry);
  await pdfEntry.press('Shift+F10');

  const splitPdfMenu = vscodeWindow.getByRole('menuitem', { name: 'Split PDF' });
  await expect(splitPdfMenu).toBeVisible();
  await splitPdfMenu.hover();
  await vscodeWindow.keyboard.press('ArrowRight');

  const configureMenu = vscodeWindow.getByRole('menuitem', { name: 'Configure split' });
  await expect(configureMenu).toBeVisible();
  await configureMenu.hover();
  await expect(configureMenu).toBeFocused();
  await vscodeWindow.keyboard.press('Enter');

  let webviewFrame: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of vscodeWindow.frames()) {
          const heading = frame.locator('h1').filter({ hasText: /^Split PDF$/ });
          if ((await heading.count()) > 0) {
            webviewFrame = frame;
            return true;
          }
        }

        return false;
      },
      {
        message: 'Split PDF Configure webview was not created.',
      },
    )
    .toBe(true);

  if (!webviewFrame) {
    throw new Error('Split PDF Configure webview was not found after it was created.');
  }

  return {
    body: webviewFrame.locator('body'),
    canvases: webviewFrame.locator('canvas[data-pdf-page]'),
    frame: webviewFrame,
    preview: webviewFrame.getByRole('region', { name: 'PDF preview' }),
    groups: webviewFrame.getByRole('region', { name: 'Groups' }),
  };
}

export async function captureSplitPdfScreenshot(page: Page, body: Locator): Promise<Buffer> {
  await body.evaluate((element) => {
    const document = element.ownerDocument;

    if (!document.querySelector('style[data-e2e-snapshot]')) {
      const style = document.createElement('style');
      style.dataset.e2eSnapshot = 'true';
      style.textContent =
        '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
      document.head.append(style);
    }
  });
  await waitForWebviewFontsReady(body);
  await settleWebviewPaint(page);
  const bodyBounds = await body.boundingBox();

  if (!bodyBounds) {
    throw new Error('Split PDF Configure webview body has no visible bounds.');
  }

  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: bodyBounds,
  });
}
