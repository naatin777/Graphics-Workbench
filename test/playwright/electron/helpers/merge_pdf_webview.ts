import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import {
  expectWebviewHasNoHorizontalOverflow,
  expectWebviewPanesNotOverlapping,
  selectExplorerEntry,
} from './crop_pdf_webview.js';
import { settleWebviewPaint, waitForWebviewFontsReady, waitForWebviewLayoutToSettle } from './crop_pdf_screenshot.js';

export interface MergePdfWebview {
  body: Locator;
  canvases: Locator;
  frame: Frame;
}

export async function openMergePdfConfigure(vscodeWindow: Page, fileNames: string[]): Promise<MergePdfWebview> {
  await expect(vscodeWindow.getByText('Safe Mode: ON', { exact: true })).toBeVisible();

  const explorer = vscodeWindow.getByRole('tree', { name: 'Files Explorer' });
  await expect(explorer).toBeVisible();

  if (fileNames.length < 2) {
    throw new Error('Merge PDF requires at least 2 files.');
  }

  const entries = fileNames.map((name) => explorer.getByRole('treeitem', { name }));
  for (const entry of entries) {
    await expect(entry).toBeVisible();
  }

  const [firstEntry, ...restEntries] = entries;
  if (!firstEntry) {
    throw new Error('Expected at least one explorer entry.');
  }
  await selectExplorerEntry(firstEntry);

  const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await vscodeWindow.keyboard.down(modifierKey);
  for (const entry of restEntries) {
    await entry.click();
  }
  await vscodeWindow.keyboard.up(modifierKey);

  const [lastEntry] = entries.slice(-1);
  if (!lastEntry) {
    throw new Error('Expected at least one explorer entry.');
  }
  await lastEntry.press('Shift+F10');

  const mergePdfMenu = vscodeWindow.getByRole('menuitem', { name: 'Merge PDFs' });
  await expect(mergePdfMenu).toBeVisible();
  await mergePdfMenu.hover();
  await vscodeWindow.keyboard.press('ArrowRight');

  const configureMenu = vscodeWindow.getByRole('menuitem', { name: 'Review Order' });
  await expect(configureMenu).toBeVisible();
  await configureMenu.hover();
  await expect(configureMenu).toBeFocused();
  await vscodeWindow.keyboard.press('Enter');

  let webviewFrame: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of vscodeWindow.frames()) {
          const heading = frame.locator('h1').filter({ hasText: /^Merge PDFs$/ });
          if ((await heading.count()) > 0) {
            webviewFrame = frame;
            return true;
          }
        }

        return false;
      },
      {
        message: 'Merge PDF Configure webview was not created.',
      },
    )
    .toBe(true);

  if (!webviewFrame) {
    throw new Error('Merge PDF Configure webview was not found after it was created.');
  }

  await expectWebviewHasNoHorizontalOverflow(webviewFrame);
  await expectWebviewPanesNotOverlapping(webviewFrame);

  return {
    body: webviewFrame.locator('body'),
    canvases: webviewFrame.locator('canvas.thumbnail__canvas'),
    frame: webviewFrame,
  };
}

export async function captureMergePdfScreenshot(page: Page, body: Locator): Promise<Buffer> {
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
  await waitForWebviewLayoutToSettle(body);
  const bodyBounds = await body.boundingBox();

  if (!bodyBounds) {
    throw new Error('Merge PDF Configure webview body has no visible bounds.');
  }

  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: bodyBounds,
  });
}
