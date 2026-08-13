import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { expectPdfCanvasesReadable, settlePaint, webviewUrl, type ThemeQuery } from './helpers/browser';

const visualReviewRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'artifacts',
  'visual-review',
);

type VisualReviewViewport = 'wide' | 'narrow';

function visualReviewEnvironmentDirectory(): string {
  return join(visualReviewRoot, `${process.platform}-${process.arch}`);
}

async function initializeVisualReviewOutput(): Promise<void> {
  const environmentDirectory = visualReviewEnvironmentDirectory();
  await mkdir(environmentDirectory, { recursive: true });

  for (const viewport of ['wide', 'narrow'] as const) {
    const viewportDirectory = join(environmentDirectory, viewport);
    await mkdir(viewportDirectory, { recursive: true });
    const entries = await readdir(viewportDirectory).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.toLowerCase().endsWith('.png'))
        .map((entry) => rm(join(viewportDirectory, entry), { force: true })),
    );
  }
}

const configureThemes = [
  { id: 'dark', query: 'dark', themeClass: 'vscode-dark' },
  { id: 'light', query: undefined, themeClass: 'vscode-light' },
  { id: 'high-contrast', query: 'high-contrast', themeClass: 'vscode-high-contrast' },
] as const satisfies readonly { id: string; query: ThemeQuery; themeClass: string }[];

const previewThemes = [configureThemes[0], configureThemes[1]] as const;

test.beforeAll(async () => {
  await initializeVisualReviewOutput();
});

async function captureBodyScreenshot(
  page: Page,
  options: {
    fileName: string;
    pageId: string;
    theme: (typeof configureThemes)[number];
    viewport: VisualReviewViewport;
    waitForReady: (page: Page) => Promise<void>;
  },
): Promise<void> {
  await page.goto(webviewUrl({ page: options.pageId, theme: options.theme.query }));
  await expect(page.locator('body')).toHaveClass(new RegExp(`(^|\\s)${options.theme.themeClass}(\\s|$)`));
  await options.waitForReady(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settlePaint(page);
  const bodyBounds = await page.locator('body').boundingBox();
  if (!bodyBounds) {
    throw new Error('Webview body has no visible bounds.');
  }
  const outputPath = join(
    visualReviewEnvironmentDirectory(),
    options.viewport,
    `${options.fileName}-${options.theme.id}.png`,
  );
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: bodyBounds,
    fullPage: false,
    path: outputPath,
  });
  console.log(`Visual review image written: ${outputPath}`);
}

async function captureConfigureScreens(
  page: Page,
  options: {
    fileName: string;
    pageId: string;
    themes: readonly (typeof configureThemes)[number][];
    waitForReady: (page: Page) => Promise<void>;
  },
): Promise<void> {
  for (const theme of options.themes) {
    await captureBodyScreenshot(page, {
      fileName: options.fileName,
      pageId: options.pageId,
      theme,
      viewport: 'wide',
      waitForReady: options.waitForReady,
    });
  }

  await page.setViewportSize({ width: 600, height: 900 });
  for (const theme of options.themes) {
    await captureBodyScreenshot(page, {
      fileName: options.fileName,
      pageId: options.pageId,
      theme,
      viewport: 'narrow',
      waitForReady: options.waitForReady,
    });
  }
}

async function capturePreviewScreens(
  page: Page,
  pageId: string,
  themes: readonly (typeof configureThemes)[number][],
): Promise<void> {
  await captureConfigureScreens(page, {
    fileName: 'pdf-preview',
    pageId,
    themes,
    waitForReady: async (currentPage) => {
      await expectPdfCanvasesReadable(currentPage.locator('canvas[data-pdf-page]'));
    },
  });
}

test('capture Crop PDF Configure screenshots for visual review', async ({ page }) => {
  await captureConfigureScreens(page, {
    fileName: 'crop-configure',
    pageId: 'crop-pdf',
    themes: configureThemes,
    waitForReady: async (currentPage) => {
      await expectPdfCanvasesReadable(currentPage.locator('canvas[data-pdf-page]'));
    },
  });
});

test('capture Merge PDF Configure screenshots for visual review', async ({ page }) => {
  await captureConfigureScreens(page, {
    fileName: 'merge-configure',
    pageId: 'merge-pdf',
    themes: configureThemes,
    waitForReady: async (currentPage) => {
      await expect(currentPage.locator('.source-card')).toHaveCount(2);
      await expectPdfCanvasesReadable(currentPage.locator('.thumbnail__canvas'));
    },
  });
});

test('capture Split PDF Configure screenshots for visual review', async ({ page }) => {
  await captureConfigureScreens(page, {
    fileName: 'split-configure',
    pageId: 'split-pdf',
    themes: configureThemes,
    waitForReady: async (currentPage) => {
      await currentPage.getByRole('textbox', { name: 'Pages 1', exact: true }).fill('1');
      await currentPage.getByRole('button', { name: 'All pages', exact: true }).click();
      await expectPdfCanvasesReadable(currentPage.locator('canvas[data-pdf-page="1"]'));
    },
  });
});

test('capture PDF preview screenshots for visual review', async ({ page }) => {
  await capturePreviewScreens(page, 'preview', previewThemes);
});
