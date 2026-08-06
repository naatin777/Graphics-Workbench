import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { expectWebviewHasNoHorizontalOverflow, selectExplorerEntry } from './crop_pdf_webview.js';
import { settleWebviewPaint, waitForWebviewFontsReady, waitForWebviewLayoutToSettle } from './crop_pdf_screenshot.js';

export interface RotatePdfWebview {
  frame: Frame;
  pages: Locator;
}

export interface ReorderPdfWebview {
  frame: Frame;
  pages: Locator;
}

async function openConfigureWebview(
  vscodeWindow: Page,
  fileName: string,
  submenuName: string,
  configureName: string,
  headingPattern: RegExp,
): Promise<Frame> {
  await expect(vscodeWindow.getByText('Safe Mode: ON', { exact: true })).toBeVisible();

  const explorer = vscodeWindow.getByRole('tree', { name: 'Files Explorer' });
  await expect(explorer).toBeVisible();

  const pdfEntry = explorer.getByRole('treeitem', { name: fileName });
  await expect(pdfEntry).toBeVisible();
  await selectExplorerEntry(pdfEntry);
  await pdfEntry.press('Shift+F10');

  const submenu = vscodeWindow.getByRole('menuitem', { name: submenuName });
  await expect(submenu).toBeVisible();
  await submenu.hover();
  await vscodeWindow.keyboard.press('ArrowRight');

  const configureMenu = vscodeWindow.getByRole('menuitem', { name: configureName });
  await expect(configureMenu).toBeVisible();
  await configureMenu.hover();
  await expect(configureMenu).toBeFocused();
  await vscodeWindow.keyboard.press('Enter');

  let webviewFrame: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of vscodeWindow.frames()) {
          const heading = frame.locator('h1').filter({ hasText: headingPattern });
          if ((await heading.count()) > 0) {
            webviewFrame = frame;
            return true;
          }
        }

        return false;
      },
      {
        message: `${submenuName} Configure webview was not created.`,
      },
    )
    .toBe(true);

  if (!webviewFrame) {
    throw new Error(`${submenuName} Configure webview was not found after it was created.`);
  }

  await expectWebviewHasNoHorizontalOverflow(webviewFrame);
  return webviewFrame;
}

export async function openRotatePdfConfigure(vscodeWindow: Page, fileName: string): Promise<RotatePdfWebview> {
  const frame = await openConfigureWebview(vscodeWindow, fileName, 'Rotate PDF', 'Choose Pages', /^Rotate PDF$/);
  return { frame, pages: frame.locator('.rotate__pages .pdf-page') };
}

export async function openReorderPdfConfigure(vscodeWindow: Page, fileName: string): Promise<ReorderPdfWebview> {
  const frame = await openConfigureWebview(vscodeWindow, fileName, 'Reorder PDF', 'Reorder PDF Pages', /^Reorder PDF$/);
  return { frame, pages: frame.locator('.reorder__pages .pdf-page') };
}

export async function captureRotatePdfScreenshot(page: Page, body: Locator): Promise<Buffer> {
  await disableAnimations(body);
  await waitForWebviewFontsReady(body);
  await settleWebviewPaint(page);
  await waitForWebviewLayoutToSettle(body);
  const bodyBounds = await body.boundingBox();

  if (!bodyBounds) {
    throw new Error('Rotate PDF Configure webview body has no visible bounds.');
  }

  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: bodyBounds,
  });
}

async function disableAnimations(body: Locator): Promise<void> {
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
}
