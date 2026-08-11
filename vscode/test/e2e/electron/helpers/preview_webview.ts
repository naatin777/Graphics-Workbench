import { cp } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { testInputDirectory } from '../../../support/helpers/fixture_paths.js';
import { expectPdfCanvasesReadable, readWebviewBodyColors } from './crop_pdf_webview.js';
import {
  captureCropPdfScreenshot,
  settleWebviewPaint,
  waitForWebviewFontsReady,
  waitForWebviewLayoutToSettle,
} from './crop_pdf_screenshot.js';
import { writeVscodeUserSettings } from './vscode_electron_test.js';

export const tiffPreviewFixtureFileName = 'heatmap.tiff';

export interface PreviewWebview {
  body: Locator;
  canvases: Locator;
  frame: Frame;
  images: Locator;
}

/** Copies the multi-page TIFF fixture into the workspace. */
export async function copyTiffPreviewFixture(workspacePath: string): Promise<string> {
  const sourcePath = join(testInputDirectory, 'valid', 'tiff', tiffPreviewFixtureFileName);
  await cp(sourcePath, join(workspacePath, tiffPreviewFixtureFileName));
  return tiffPreviewFixtureFileName;
}

/**
 * Opens a file through the configured custom editor association and waits until
 * the preview webview has rendered its content.
 */
export async function openPreviewEditor(
  vscodeWindow: Page,
  fileName: string,
  options: { waitFor: 'pdf' | 'tiff' },
): Promise<PreviewWebview> {
  await expect(vscodeWindow.getByRole('button', { name: /Graphics Workbench Controls/ })).toBeVisible();

  const explorer = vscodeWindow.getByRole('tree', { name: 'Files Explorer' });
  await expect(explorer).toBeVisible();

  const entry = explorer.getByRole('treeitem', { name: fileName });
  await expect(entry).toBeVisible();
  await entry.dblclick();

  let webviewFrame: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of vscodeWindow.frames()) {
          const heading = frame.locator('h1').filter({ hasText: /^Preview$/ });
          if ((await heading.count()) > 0) {
            webviewFrame = frame;
            return true;
          }
        }

        return false;
      },
      {
        message: `Preview webview was not created for ${fileName}.`,
      },
    )
    .toBe(true);

  if (!webviewFrame) {
    throw new Error(`Preview webview was not found for ${fileName}.`);
  }

  const canvases = webviewFrame.locator('canvas[data-pdf-page]');
  const images = webviewFrame.locator('img.preview-page__image');
  if (options.waitFor === 'pdf') {
    await expectPdfCanvasesReadable(canvases, 'PDF preview did not render.');
  } else {
    await waitForTiffPreviewImages(images);
  }

  return { body: webviewFrame.locator('body'), canvases, frame: webviewFrame, images };
}

export async function waitForTiffPreviewImages(images: Locator): Promise<void> {
  await expect
    .poll(() => images.count(), { message: 'TIFF preview must create at least one page image.' })
    .toBeGreaterThan(0);

  const firstPage = images.first();
  await expect
    .poll(
      async () => {
        const state = await firstPage.evaluate((element) => ({
          hasDataUri: element.src.startsWith('data:image/png'),
          loaded: element.naturalWidth > 0,
        }));
        return state.hasDataUri && state.loaded;
      },
      { message: 'TIFF preview first page did not load.' },
    )
    .toBe(true);
}

/**
 * Captures the preview webview. PDF pages are composited from their canvas
 * pixel data because Playwright can read an OOPIF canvas as black; TIFF pages
 * are plain images and are captured as rendered.
 */
export async function capturePreviewScreenshot(
  page: Page,
  body: Locator,
  canvases: Locator,
  options: { snapshotPrefix: string; type: 'pdf' | 'tiff' },
): Promise<Buffer> {
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

  if (options.type === 'pdf') {
    return captureCropPdfScreenshot(page, body, {
      canvases,
      previewSelector: '.preview',
      snapshotPrefix: options.snapshotPrefix,
    });
  }

  await waitForWebviewLayoutToSettle(body);
  const bodyBounds = await body.boundingBox();
  if (!bodyBounds) {
    throw new Error('Preview webview body has no visible bounds.');
  }
  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: bodyBounds,
  });
}

/** Applies a color theme and waits until the preview webview has adopted it. */
export async function applyPreviewTheme(
  settingsPath: string,
  theme: { colorTheme: string; themeClass: string },
  body: Locator,
): Promise<void> {
  await writeVscodeUserSettings(settingsPath, theme.colorTheme);
  await expect(body).toHaveClass(new RegExp(`(^|\\s)${theme.themeClass}(\\s|$)`));
  await expect
    .poll(
      async () => {
        const state = await readWebviewBodyColors(body);
        return state.bodyBackground !== 'transparent' && state.bodyBackground !== 'rgba(0, 0, 0, 0)';
      },
      { message: 'Preview webview did not adopt the theme colors.' },
    )
    .toBe(true);
}
